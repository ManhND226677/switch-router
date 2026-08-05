# Switch-Router Changelog

This file tracks changes for the local personal build only.

## 0.2.0 — 2026-08-04

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

- Removed upstream donate, changelog, and package update feeds.
- Removed the updater path that could replace Switch-Router with the original npm package.
- Kept local provider routing, fallback, usage tracking, and CLI tool auto-import behavior.
