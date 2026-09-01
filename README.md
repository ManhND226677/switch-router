# Switch-Router

Switch-Router is a local-first, single-user AI gateway and Web dashboard. It exposes one OpenAI-compatible API (`/v1`) while routing requests across configured providers, models, accounts, and combos — with format translation, multi-account fallback, token refresh, quota tracking, and a SQLite persistence layer. Default port: `28701`.

## Features

- **One gateway surface** — `/v1/chat/completions`, `/v1/messages` (Anthropic-compatible), `/v1/responses`, plus an isolated `/office/v1` namespace for Claude for M365.
- **Virtual API keys** — per-key model allowlist, monthly USD budget, RPM rate limit, expiry, and last-used tracking.
- **Combos & fallback** — ordered model fallback or round-robin across providers and accounts.
- **Context guard** — a provider's "prompt too long" rejection is treated as a payload fault (no pointless account rotation) and, when enabled, the oldest turns are dropped to fit the window the provider reported and the request is replayed once on the same account; the response carries `x-switch-router-context-trim`.
- **Local-only dashboard** — loopback-gated, no password/OIDC login; gateway auth stays separate.
- **SQLite storage** — driver chain `bun:sqlite` → `better-sqlite3` → `node:sqlite` → `sql.js` (pure-JS fallback always works).
- **WorkBuddy AI (free Hy4 Preview)** — one-click import of the logged-in WorkBuddy AI desktop-app session (or real web login on app-less hosts), self-refreshing tokens, 19 models incl. the free-trial `hy4-preview`. Guide: [`docs/WORKBUDDY-FREE-HY4.md`](docs/WORKBUDDY-FREE-HY4.md).

## Requirements

| Tool | Version |
|------|---------|
| Node.js | **≥ 24** (required, see `package.json` `engines`) |
| npm | bundled with Node |
| Bun *(optional)* | only for the `*:bun` script variants |
| Python + `fonttools`/`brotli` *(optional)* | only to regenerate the icon font subset |

Windows, macOS, and Linux are supported. Windows gets an optional tray launcher (see below).

## Installation

```bash
# 1. Clone
git clone https://github.com/ManhND226677/switch-router.git
cd switch-router

# 2. Configure environment
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env

# 3. Install dependencies
npm install
```

`.env` is optional for local use — sensible defaults apply when absent. See `.env.example` for the full contract (`API_KEY_SECRET`, outbound proxy settings, …). Never commit your `.env`.

## Running

Development (dashboard + hot reload):

```bash
npm run dev
```

Production:

```bash
npm run build
npm start                   # custom-server.js — required for correct client-IP handling
```

Bun variants: `npm run dev:bun`, `npm run build:bun`, `npm run start:bun`.

Then open the dashboard:

```text
http://127.0.0.1:28701/dashboard
```

The server **always binds to `127.0.0.1`** — Switch-Router is local-first and external hosting was removed, so `HOSTNAME` is no longer honored for binding (any value is overridden to loopback). `PORT` remains configurable. A local reverse proxy still works because it connects from `127.0.0.1`, the only peer the local-only guard trusts. Always start through `npm start` (not bare `next start`): `custom-server.js` derives the client IP from the TCP socket and strips spoofable `X-Forwarded-For` headers, which the local-only guard relies on.

### First-run checklist

1. Open `/dashboard` — it is reachable from this machine only.
2. Add a provider (API key or OAuth) under **Providers**.
3. Optionally create models aliases/combos under **Combos**.
4. If you want to require API keys on the gateway, enable it in settings and create keys — regular keys under **Keys**, policy-limited virtual keys (allowlist / budget / RPM / expiry) under **Virtual Keys**.

## API

Base URL:

```text
http://127.0.0.1:28701/v1
```

Main endpoints:

```text
POST /v1/chat/completions     # OpenAI-compatible chat
POST /v1/messages             # Anthropic Messages-compatible
POST /v1/responses            # Responses API (Codex CLI: base_url <origin>/v1)
GET  /v1/models
```

API-key enforcement is optional for trusted loopback use. When enabled, send `Authorization: Bearer <key>` (or `x-api-key`). Virtual-key policies (expiry, allowlist, budget, RPM) are enforced on every request that presents a valid key.

Claude for M365 gateway (disabled by default):

```text
GET  /office/v1/models
POST /office/v1/messages
```

Set `OFFICE_GATEWAY_ENABLED=true` and configure Claude for M365 with the HTTPS base URL of a reverse proxy, `gateway_api_format=anthropic`, and a dedicated Switch-Router API key. The Office namespace requires that key even when global API-key enforcement is disabled. `OFFICE_MODEL_IDS` can restrict the Office catalog to exact IDs.

### Model discovery

```bash
curl http://127.0.0.1:28701/v1/models
```

Use a returned model id in requests. Combos and aliases are managed from the dashboard.

## Model selection & fallback

- Direct model ids use `provider/model`.
- Combos provide ordered fallback or round-robin across models/accounts.
- Account-level fallback, provider selection, and token refresh are handled by the routing core.
- Streaming responses use SSE and preserve the selected client format.

## CLI-tool integrations

The dashboard configures local CLI tools (Claude, OpenClaw, Codex, OpenCode, Cowork, Hermes) and can auto-import their credentials. Existing external configuration keys named `9router` are preserved so applying Switch-Router settings does not invalidate existing tool files.

## Windows tray & auto-start (optional)

```bash
npm run icon              # regenerate public/icons/switch-router.ico
npm run tray              # tray icon + start the server (console attached)
npm run tray:hidden       # tray icon only, no console window
npm run autostart         # Startup shortcut for the CURRENT user
npm run autostart:status  # report enabled/disabled
npm run autostart:remove  # delete the Startup shortcut
```

Stop/restart from the tray only targets node processes belonging to this checkout; a foreign listener on the port is reported, never killed. See [docs/WINDOWS-TRAY.md](docs/WINDOWS-TRAY.md).

## Data & credentials

State lives in SQLite at `DATA_DIR/db/data.sqlite` (legacy installs fall back to `~/.9router/`). Provider credentials never leave the machine. Gateway API keys are stored fingerprinted in usage records; raw keys are never exported. Backups are taken automatically before schema migrations (see `src/lib/db/backup.js`).

## Development

```bash
npm install                     # root deps first
cd tests && npm install         # vitest lives in an independent ESM package
npx vitest run                  # full suite (from tests/)
npx eslint .                    # lint
node scripts/qa-provider-drift.mjs
```

Regression gates compare against committed snapshots under `tests/__baseline__/`. See [docs/QA-WORKFLOW.md](docs/QA-WORKFLOW.md). Engine conventions (adding providers/translators) are documented in [`open-sse/AGENTS.md`](open-sse/AGENTS.md).

## Architecture

- `src/app/api/v1/*` — Next.js route handlers behind the `/v1` rewrite.
- `src/sse/handlers/*` — request validation, combo orchestration, credential/key-policy enforcement.
- `src/core/routing/*` — account fallback and provider-selection policy.
- `open-sse/*` — provider adapters, translation engine, streaming, normalization (usable standalone).
- `src/lib/db/*` — SQLite layer: driver chain, migrations, repos.

Full request flow and data model: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Security model

- Dashboard and management APIs are **loopback-only**, enforced via the TCP-derived peer IP stamped by `custom-server.js`; forwarding headers from non-loopback sources are stripped.
- The server binds to `127.0.0.1` unconditionally — external hosting is not supported, and `HOSTNAME` is ignored for binding.
- The `/v1/realtime` WebSocket relay runs in `custom-server.js` (outside the Next middleware), so it enforces loopback on its own: it rejects a non-loopback TCP peer and a non-loopback browser `Origin` before resolving any provider credential.
- `/v1/*` is the single public gateway surface and uses its own API-key/CLI-token auth.
- Local-only routes additionally require the machine's CLI token (`x-9r-cli-token`), value-verified against the host.

## License

MIT. See [LICENSE](LICENSE).
