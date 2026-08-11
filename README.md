# Switch-Router

Switch-Router is a local-first, single-user AI gateway and Web dashboard. It exposes one OpenAI-compatible API while routing requests across configured providers, models, accounts, and combos.

The runtime retains mature provider and translation work from the upstream codebase, but this project is maintained as Switch-Router. The default Web port is `28701`.

## Start

```bash
npm install
npm run dev
```

Open the dashboard at:

```text
http://127.0.0.1:28701/dashboard
```

Production build:

```bash
npm run build
npm start
```

The server binds to `127.0.0.1` by default. Set `HOSTNAME` and `PORT` explicitly only when a different local runtime is required.

## API

Base URL:

```text
http://127.0.0.1:28701/v1
```

Main endpoints:

```text
POST /v1/chat/completions
POST /v1/messages
GET  /v1/models
```

API-key enforcement is optional for trusted loopback use. When enabled, send `Authorization: Bearer <key>`.

Claude for M365 gateway (disabled by default):

```text
GET  /office/v1/models
POST /office/v1/messages
```

Set `OFFICE_GATEWAY_ENABLED=true` and configure Claude for M365 with the HTTPS
base URL of a reverse proxy, `gateway_api_format=anthropic`, and a dedicated
Switch-Router API key. The Office namespace requires that key even when the
global loopback API-key setting is disabled. `OFFICE_MODEL_IDS` can restrict
the Office model catalog to exact IDs.

See [docs/CLAUDE-OFFICE.vi.md](docs/CLAUDE-OFFICE.vi.md) for the isolated
HTTPS reverse-proxy and Claude for M365 manifest setup.

## Model discovery

```bash
curl http://127.0.0.1:28701/v1/models
```

Use a returned model id in requests. Combos and model aliases are managed from the dashboard.

## Model Selection And Fallback

- Direct model ids use `provider/model`.
- Combos provide ordered model fallback or round-robin behavior.
- Account-level fallback, provider selection, and token refresh are handled by the account selection core.
- Streaming chat responses use SSE and preserve the selected client format.

## CLI-tool integrations

The Web dashboard retains local CLI-tool configuration and auto-import integrations for Claude, OpenClaw, Codex, OpenCode, Cowork, and Hermes. The project does not ship a separate CLI launcher package.

Existing external tool configuration keys named `9router` are preserved so applying Switch-Router settings does not invalidate existing tool files.

## Windows tray and auto-start

Optional Windows-only launcher scripts under `scripts/windows/`. They wrap the same `npm start` runtime — no service, no Scheduled Task, no change to `HOSTNAME`, `PORT`, or any endpoint.

```bash
npm run icon              # regenerate public/icons/switch-router.ico
npm run tray              # tray icon + start the server (console stays attached)
npm run tray:hidden       # tray icon only, no console window
npm run autostart         # add Startup shortcut for the CURRENT user
npm run autostart:status  # report enabled/disabled
npm run autostart:remove  # delete the Startup shortcut
```

Tray menu: open dashboard, copy base URL, start/stop/restart the server, open the
logs folder, and toggle auto-start. Stop/restart only target node processes that
belong to this checkout; a foreign listener on the port is reported, never killed.
`PORT`/`HOSTNAME` are read from `.env.local`, then `.env`, exactly like `custom-server.js`.

Auto-start creates one per-user shortcut:

```text
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Switch-Router.lnk
```

See [docs/WINDOWS-TRAY.md](docs/WINDOWS-TRAY.md) for details and troubleshooting.

## Data and credentials

State is stored in SQLite under `DATA_DIR/db/data.sqlite`. Provider API keys and OAuth credentials remain local. New installations use the Switch-Router data directory; an existing `.9router` directory is reused automatically when no new directory exists.

## Architecture

- `src/app/api/v1/*`: compatibility API routes.
- `src/sse/handlers/*`: request validation, combo orchestration, credential fallback, and chat streaming.
- `src/core/routing/*`: account fallback and provider selection policy.
- `src/core/providers/*`: stable boundary to provider executors.
- `open-sse/*`: provider adapters, translation, streaming, and response normalization.
- `src/lib/*`: local database, credentials, usage, settings, and runtime paths.

See [docs/SWITCH-ROUTER.md](docs/SWITCH-ROUTER.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the detailed request flow and model selection behavior.

## Verification

```bash
npm run build
npm start
```

Then verify `http://127.0.0.1:28701/dashboard` and `/v1/models`.

Windows launcher self-check (no UI, starts/stops nothing):

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/tray.ps1 -SelfTest
```

## License

MIT. See [LICENSE](LICENSE).
