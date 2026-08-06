# Switch-Router Changelog

This file tracks changes for the local personal build only.

## 0.5.0 — 2026-08-06

### Removed

- **6 unused providers**: nvidia, fireworks, siliconflow, cline, clinepass, kimchi
  - Registry entries, executors (kimchi), OAuth flows (cline/clinepass/kimchi), services (clinepassModels, kimchiModels, clineAuth)
  - API endpoint logic (validate, test, models), handler branches (embeddingProviders, sttCore, ttsProviders, capabilities)
  - UI components (OAuthModal kimchi token input)
  - Test files (nvidia-thinking.e2e.test.js, kimchi*.test.js)
  - Registry count: 46 → 40 providers
  - Alias count: 74 → 68 tokens
  - **All baselines re-snapshotted and verified green** (providers-baseline.json, alias-baseline.json, oauth-urls-baseline.json)

## 0.2.0 — 2026-08-04

### Removed (from upstream)

- Removed upstream donate, changelog, and package update feeds.
- Removed the updater path that could replace Switch-Router with the original npm package.

### Added

- **ViLao AI provider** (`vilao`) — P2P models marketplace behind one
  OpenAI-compatible endpoint (`https://api.vilao.ai/v1`). Verified live against
  the real gateway: chat (streaming + non-streaming), tool calling, and the
  dynamic model catalog all work end to end through `/v1/chat/completions`.
  - `passthroughModels` + `modelsFetcher`: model ids are the marketplace
    ids/aliases subscribed to each key, so any id is accepted and the catalog is
    resolved at runtime rather than hardcoded.
  - `forceStream: true` — measured against `api.vilao.ai`, streaming succeeded
    10/10 while non-streaming hung past 45s on 5 of 9 attempts. The engine now
    always requests SSE upstream and converts it back to JSON for non-streaming
    clients (`handleForcedSSEToJson`).
  - Per-key endpoint override via `providerSpecificData.baseUrl` — ViLao's docs
    mask the gateway as `https://<endpoint>/v1` and tell users to copy it from
    their own API Keys page, so the host is not assumed to be fixed.
  - Deliberately no `thinkingConfig`: `reasoning_effort` is validated by the
    upstream model, not the gateway (`high`/`medium` accepted, `none`/`minimal`
    rejected with 400 on kimi-k3), and the model set is user-defined per key.
  - `402 Payment Required` (empty wallet) is treated as a *valid* key when
    validating/testing a connection; `403` means the model is not subscribed.
  - Provider links (`website`, `notice.apiKeyUrl`, `notice.signupUrl`) point at
    the referral link `https://vilao.ai/r/REF2fXFGBsf`, so the dashboard's
    "Get API Key" button attributes sign-ups.
- `scripts/generate-registry-index.mjs` — the missing generator for
  `open-sse/providers/registry/index.js`. That file is documented as
  auto-generated, but neither `migrate-registry.mjs` nor
  `injectDisplayToRegistry.mjs` writes it (both skip `index.js`). Supports
  `--check` for CI-style verification.
- `scripts/verify-additive-registry.mjs` — proves a registry change is purely
  additive (no existing provider, alias, or model key mutated; no new alias
  collision).
- `scripts/compare-vitest-runs.mjs` — Windows-safe regression gate.
  `tests/__baseline__/verify-no-regression.mjs` keys failures on a Linux
  container path (`/app/`), so on Windows every test name collapses to
  `undefined` and it falsely reports all 39 known failures as regressions.

### Fixed

- **CLI Tools page reported installed tools as "Not installed".** Each
  `/api/cli-tools/*-settings` route detected its tool with a bare
  `where`/`which` (PATH plus only `%APPDATA%\npm`) and a single config-file
  probe, which misses every real install layout that is not on the inherited
  PATH. New shared detector `src/lib/cliDetect.js` probes in three layers:
  PATH with the usual global bin dirs injected (`~/.bun/bin`, `~/.local/bin`,
  `%LOCALAPPDATA%\pnpm`, WinGet Links, scoop shims, chocolatey), then those
  dirs directly with Windows executable extensions, then per-tool marker
  files/dirs.
  - Claude Desktop installed from the Microsoft Store (MSIX) is now detected:
    its data is redirected to
    `%LOCALAPPDATA%\Packages\Claude_<hash>\LocalCache\Roaming\Claude`, so it has
    neither a PATH shim nor `~/.claude`. Resolved via a new
    `findChildDirByPrefix` helper because the package folder carries a
    publisher hash.
  - OpenCode is detected via `~/.local/share/opencode` and
    `%APPDATA%\ai.opencode.desktop`; Open Claw via `%APPDATA%\clawhub` and the
    `claw` binary name; Hermes also accepts `hermes-agent`.

### Changed

- Regenerated `tests/__baseline__/providers-baseline.json` and
  `alias-baseline.json` for the new provider (verified additive first).
- `.gitignore`: ignore `.vilao-key` and `*.local-key` so local provider
  credentials used by test scripts can never be committed.

## Unreleased

### Changed (UI/UX)

- **Unified landing page brand color with the dashboard design system (P0).**
  The marketing landing (`src/app/landing/*`) previously hard-coded a different
  orange (`#f97815`) than the dashboard's brand token (`#E56A4A`), making the two
  surfaces read as two different products. All 9 landing files now use the shared
  brand tokens:
  - Brand orange `#f97815` → `bg-brand-500` / `text-brand-500` / `border-brand-500`
    / `from-/via-/to-brand-*` Tailwind utilities, plus `var(--color-brand-500)`
    for inline-style gradients and SVG strokes.
  - Hover orange `#e0650a` → `brand-600` (`#cc5236`).
  - Orange glow shadows `rgba(249,120,21,…)` → `rgba(229,106,74,…)` (brand-500 RGB).
  - Dark neutrals aligned to the dashboard dark palette: `#1a1a1a` (bg),
    `#262626` (surface), `#333333` (border).
  - Button text on orange CTAs `#181411` → `text-white` (matches the dashboard
    primary `Button`).
  - No visual behavior changed; the landing now follows the same `--color-brand-*`
    tokens as the rest of the app, so future brand changes propagate automatically.

- **Maximized Vietnamese i18n coverage (P1).** Auto-extracted every visible UI
  string across `src/app`, `src/shared`, `src/lib`, `src/core`, `src/models`,
  diffed against `public/i18n/literals/vi.json`, and translated the genuine gaps
  — **+121 entries (201 → 322)**. Code fragments, brand names (GitHub/Twitter/
  Voyage AI), example values, and API versions were deliberately left in English.
  English remains the source/key, so it is complete by definition; Vietnamese now
  covers essentially all static UI text.

- **Gated client `console.log` in production (P1).** New `ClientConsoleGate`
  component (client-only `useEffect`, never runs during SSR) silences `log` /
  `debug` / `info` when `NODE_ENV === "production"`, while keeping `error` / `warn`.
  It does **not** touch the server-side `consoleLogBuffer`, so the in-app
  "Console Log" dashboard is unaffected. Set `window.__SR_KEEP_LOGS = true` to
  re-enable client logs at runtime.

- **Replaced hand-rolled "Test All" buttons with the shared `Button` (P2).** The
  three OAuth / Free / API Key "Test All" buttons in
  `src/app/(dashboard)/dashboard/providers/page.js` now use the shared
  `<Button variant="outline">` with a proper loading state. Removed the dead
  `dotColors` / `dotLabels` blocks from `ProviderCard` and `ApiKeyProviderCard`.

- **Restructured the dashboard sidebar IA (P2).** Nav items are now grouped under
  three labeled sections — **Providers & Models**, **Observability**, **System** —
  via new `NavLink` / `NavSection` helpers. Debug surfaces (Console Log, Translator)
  are hidden behind `enableDebug` (from `/api/settings`; defaults visible unless
  `ENABLE_DEBUG=false`); the Translator also keeps its `enableTranslator` gate.

- **Cleaned the git working tree (P3).** Committed the prior Kiro/Cerebras/Blackbox/
  Azure provider removal and the evaluation-driven UI/UX fixes as separate, clearly
  described commits. TypeScript migration is recorded as a **long-term
  recommendation** (not executed, to avoid breaking the build).

## 0.4.0 — 2026-08-06

### Fixed

- **Claude in Excel / Claude for M365 could not connect** (`Unable to connect. Check
  your network connection and ensure access to the API is not blocked.`). The Office
  taskpane talks to the gateway through the Anthropic **browser** SDK, which always
  attaches `anthropic-dangerous-direct-browser-access` plus the `x-stainless-*`
  header family. `OFFICE_ALLOWED_HEADERS` only listed 6 headers, so the CORS
  preflight omitted the ones the browser asked for and the fetch was blocked before
  it ever left the machine — the gateway itself was healthy the whole time
  (`curl`/PowerShell calls returned 200). `src/app/office/v1/_shared.js` now:
  - allows the full Anthropic browser-SDK header set;
  - echoes any additional `Access-Control-Request-Headers` back (lowercased and
    deduped) so a future SDK version cannot break the preflight again;
  - answers Chromium **Private Network Access** preflights with
    `Access-Control-Allow-Private-Network: true` (an HTTPS page calling a loopback
    gateway requires it);
  - sets `Vary: Origin, Access-Control-Request-Headers`.

  The add-in's gateway config lives in the Office WebView2 Local Storage under
  `_OfficeRuntime_Storage_claude.inference.profile`, **not** in the registry
  (`HKCU\...\WEF\Developer` only holds sideloaded manifest paths).

### Removed

- **9 providers**, with every downstream reference cleaned up: `cohere`,
  `byteplus`, `vertex`, `nebius`, `perplexity-agent`, `venice`,
  `vercel-ai-gateway`, `perplexity`, `vertex-partner`.
  `PROVIDERS` 61 → 52, registry entries 93 → 84.
  - `VertexExecutor` (served both `vertex` and `vertex-partner`) and the
    `openai-to-vertex` translator.
  - The `vertex` **translator format** itself (`FORMATS.VERTEX`) — verified no
    remaining provider resolves to that format, so the format branches in
    `modality.js`, `prefetch.js`, `thinkingUnified.js`, `systemInject.js`,
    `nonStreamingHandler.js`, `stream.js` and `gemini-to-openai.js` were dead code.
    `gemini` / `gemini-cli` / `antigravity` keep their own formats and are untouched.
  - `getVercelAiGatewayUsage` + its module-level credits URL, the `vertex` /
    `vertex-partner` token-refresh handlers and the Vertex service-account JWT
    minting path.
  - `perplexity` search builder/normalizer and the `perplexity` /
    `perplexity-agent` chat-search providers. Other search providers (exa,
    brave-search, tavily, serper, google-pse, linkup, searchapi) are unaffected.
  - `nebius` / `vercel-ai-gateway` embedding adapters and the
    `vercel-ai-gateway` image adapter.
  - Dashboard/API references: provider model-fetch configs, `validate` and
    `test` cases, and the `vercel-ai-gateway` quota normalizer.

  > **`perplexity-web` is a different provider and is kept.** It has its own
  > registry entry and executor; every `perplexity` regex matches it too.

- **Kiro dead code left over from 0.3.0.** The provider was removed then, but
  references survived and the build printed `Attempted import error` warnings on
  every run: the 146-line `kiro` OAuth block in `src/lib/oauth/providers.js`,
  `KIRO_CONFIG` imports in `providers.js` and `testUtils.js`, the `kiro` token
  refresh branch, and the `KiroOAuthWrapper` import/JSX in the provider detail
  page. The build is now `✓ Compiled successfully` with no warnings.

### Changed

- `tests/__baseline__/known-fails.txt` trimmed 25 → 15 entries. The 10 stale
  `rtk.test.js` entries pass again (45/45 verified), so they no longer mask a
  real regression.
- Removed 3 obsolete Kiro golden snapshots and re-snapshotted the three
  provider baselines (`providers` 52, `alias` 75 tokens, `oauth-urls`).
- Local data: dropped the orphaned `cohere` and `byteplus` keys from
  `settings.providerStrategies` (19 → 17). Migration 003 cannot clean these —
  it only prunes ids with a dynamic prefix (`openai-compatible-chat-`,
  `anthropic-compatible-`, …), so static provider ids are skipped. Applied after
  a dry run on a DB copy, with a `data.pre-provclean-*.sqlite` backup.

## 0.3.0 — 2026-08-05

### Removed

- **Cerebras provider** (`cerebras`) — OpenAI-compatible upstream no longer included.
- **Blackbox AI provider** (`blackbox`) — model aggregator no longer included.
- **Kiro AI provider** (`kiro`) — AWS CodeWhisperer-based provider fully removed:
  - Custom `KiroExecutor` (AWS EventStream binary format)
  - All 4 translators (openai↔kiro, claude↔kiro)
  - `kiroConstants.js`, `kiroModels.js`, `kiroSessionReplay.js`
  - OAuth flows (AWS Builder ID, IDC, Social, CLI import, auto-import)
  - UI components (`KiroAuthModal`, `KiroOAuthWrapper`, `KiroSocialOAuthModal`)
  - All kiro-specific RTK compression, session management, and token refresh logic
- Removed all `.cn` domain references from provider registries (kimi, glm).
- **Azure OpenAI provider** (`azure`) — removed `AzureExecutor` and Azure-specific streaming field stripping.
