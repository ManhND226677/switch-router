# Switch-Router Changelog

This file tracks changes for the local personal build only.

## 0.10.2 - 2026-08-28

### Added

- **EWMA latency sống sót qua restart:** `connectionLatency.js` trước đó chỉ nằm trong RAM → mỗi lần bật lại server, chiến lược `fastest` quay về thứ tự priority cho tới khi có request mới re-seed. Giờ có write-behind flush xuống `kv` (scope `connLatency`, debounce 5s, dọn entry quá 24h và vượt trần 500 connection), `hydrateConnectionLatency()` chạy trước quyết định chọn account khi strategy là `fastest`, và `flushConnectionLatency()` được drain ở `/api/app/shutdown` cùng `flushRrCounters`/`flushPendingUsage`. Mọi thao tác DB fail-open — mất DB layer thì hành vi trở lại đúng như bản cũ. Bảng `Routing EWMA` mới trong `LatencyCachePanel` + `GET /api/usage/latency` giờ trả thêm `routing.{strategy,accounts[]}`.
- **Session affinity (ghim hội thoại vào một account):** module mới `open-sse/services/sessionPinning.js`. Key = hash(model + 2 message đầu), TTL 15 phút, in-memory; `chat.js` tính key rồi truyền vào `getProviderCredentials(…, { sessionKey })`, chỉ ghi pin khi request thành công (`onRequestSuccess`). Lý do: prompt cache của Anthropic/Google/OpenAI nằm theo từng account, rota account giữa các turn là mất cache — chậm hơn và đắt hơn. Account bị pin nếu bị exclude/model-locked thì tự rơi về strategy thường. Bật mặc định, tắt bằng toggle **Session Affinity** trong Profile (`sessionPinEnabled`).
- **Error Analytics hoàn thiện:** `GET /api/usage/errors` trả thêm `signatures[]` (top lỗi lặp lại, đã bóc `error.message` khỏi JSON envelope + group theo status code). Trang `/dashboard/errors` dựng lại toàn bộ bằng `@/shared/components`.
- **Cache economics bằng tiền:** `getCacheStats` cộng thêm `savedUsd` (total/provider/model) = số tiền tiết kiệm nhờ mức giá `cached` rẻ hơn `input`, dùng đúng bảng giá mà `calculateCostFromTokens` đang dùng. Model không có giá → 0, không đoán.

### Fixed

- **`npm run build` và `npm run dev` đều hỏng (lỗi chặn toàn cục).** Trang `dashboard/errors` mới ở 0.10.1 import `@/components/ui/*` + `lucide-react` — những module không tồn tại trong project này → build fail; trong dev, một lỗi compile ở bất kỳ page nào làm **mọi route** trả 500, kể cả `/v1/chat/completions` (đã kiểm chứng bằng cách tạm dời thư mục page ra). Viết lại page theo `@/shared/components`, icon lấy đúng bộ glyph đã subset. Đồng thời `package.json` `dev` chuyển sang `next dev --webpack` — Next 16 mặc định Turbopack trong khi `next.config.mjs` chỉ có khối `webpack`, nên `npm run dev` in "Ready" rồi **exit code 1**; script `dev:webpack` trùng lặp bị bỏ.
- **`GET /api/usage/errors` chết 100%:** route tự viết SQL qua `db.prepare()` trong khi cả 4 adapter chỉ expose `run/get/all/exec/transaction`. Toàn bộ aggregation chuyển xuống `requestDetailsRepo.getErrorAnalytics()` (API chuẩn của adapter, tham số bind đầy đủ), route chỉ còn là wrapper; dùng cột `status` có index thay vì `json_extract(data,'$.status')`, và đọc `$.response.status` — field ghi thực tế — thay vì `$.response.status_code` không tồn tại.
- **Rò API key sang endpoint của hãng khi baseUrl bị SSRF-guard chặn:** `executors/default.js` âm thầm thay `baseUrl` riêng tư/vòng lặp bằng `api.openai.com`/`api.anthropic.com`, rồi `buildHeaders` vẫn gắn key đã lưu → key + prompt đi ra ngoài (trigger: node Compatible trỏ `http://127.0.0.1:11434/v1`, LM Studio, vLLM LAN). Nay `guardCompatibleBaseUrl()` throw lỗi tường minh nêu tên host bị chặn (chỉ host:port, không log cả URL vì URL có thể mang key), và test `executor-safe-baseurl.test.js` được viết lại vì hai case cũ **đang khoá chặt chính hành vi rò đó**.
- **Thiếu `model` trả 500 thay vì 400:** `handleChat` gọi `getComboModels(routedModelStr)` trước khi kiểm tra `modelStr`, và helper đó gọi `modelStr.includes("/")` → `TypeError` (cả với `model: {"x":1}`). Validate `typeof === "string"` ngay sau khi đọc body; nhánh 400 "Missing model" cũ thành dead code nên đã xoá.
- **`POST /v1/responses/compact` với body hỏng JSON → 500:** `request.json()` không có try/catch, trong khi mọi route chat khác trả 400. Nay dùng chung `errorResponse(400, "Invalid JSON body")`.
- **URL của Codex bị lệch một request:** `base.js` gọi `buildUrl()` **trước** `transformRequest()`, mà `_isCompact` chỉ được gán trong `transformRequest` của `codex.js` → trên executor singleton, một lần gọi `/v1/responses/compact` khiến request thường kế tiếp bị đẩy sang `.../responses/compact`. Đổi thứ tự thành transform → buildUrl → buildHeaders (vẫn giữ đúng thứ tự mà `opencode-go`/`antigravity` đang phụ thuộc).
- **Lỗi non-SSE từ upstream làm mất thông điệp và khoá oan account:** `streamingHandler.js` trả `{ success:false, response }` không có `status`/`error` → `markAccountUnavailable(conn, undefined, undefined)` rơi vào rule mặc định, khoá model 30s với `errorCode:null`, còn client nhận 503 chung chung thay vì message đã sanitize. Nay trả `createErrorResult(status, msg)` chuẩn.
- **Rò socket khi retry sau refresh token:** `chatCore.js` bỏ response của lần retry không `ok` mà không đọc/hủy → Nay gọi `body.cancel()` khi không dùng tới.
- **Một request lỗi phía client làm ô nhiễm cả pool account:** `errorConfig.js` không có rule cho 400/406/413/422 nên mọi status lạ rơi về `TRANSIENT_COOLDOWN_MS` (30s) — và text "improperly formed request" của Anthropic bị khoá tới `COOLDOWN.long` (2 phút) trên **mọi** account. Thêm rule `cooldownMs: 0` cho các 4xx deterministic; `markAccountUnavailable` không còn ghi lock/`testStatus` khi cooldown = 0. Vẫn giữ rotation để combo sang model kế tiếp và để status gốc tới tay client.
- **Chính sách virtual key không bao giờ chạy trên cài đặt mới:** allowlist/budget/RPM/expiry bị gate bằng `settings.requireApiKey`, mà cờ này không có trong `DEFAULT_SETTINGS` và toggle đã ẩn khỏi UI → người dùng cấu hình hạn chế khoá, thấy progress bar, nhưng không có gì được áp. Policy giờ gắn chặt với chính khoá (`if (apiKey)`), không phụ thuộc cờ toàn cục; `requireApiKey` được khai báo tường minh `false` trong defaults.
- **Bộ lọc ngày loại nguyên ngày được chọn:** `toValidDateIso("2026-08-27")` ra nửa đêm UTC nên `timestamp <= endDate` cắt bỏ cả ngày đó. Thêm `toValidDateUpperBoundIso()` (date-only → `T23:59:59.999Z`) và dùng cho cả `getRequestDetails`, `getUsageHistory`/`getUsageHistoryPage` lẫn analytics mới.
- **Mất safety net backup trên nền sql.js:** `backupDbLite()` dùng `ATTACH DATABASE` — sql.js coi ATTACH là một DB in-memory riêng nên file backup rỗng, và `migrate.js` chỉ `console.warn` rồi tiếp tục → đúng lúc cần bản backup trước migration xóa dữ liệu (003) thì không có. Với driver `sql.js` giờ xuất ảnh in-memory bằng `raw.export()`; phần bù là backup chứa cả `requestDetails`.
- **Xóa proxy pool làm traffic đi thẳng:** `deleteProxyPool()` để lại `proxyPoolId` mồ côi trong `providerSpecificData`; `resolveConnectionProxyConfig` không tìm thấy pool → rơi về `source:"none"`, mất cả proxy lẫn `strictProxy` của pool. Nay dọn reference trong cùng transaction và invalidate cache connections.
- **Xóa provider-node có thể xóa nhầm model của node khác:** `nodesRepo` lọc bằng `key LIKE ?` với `${id}|%`, nhưng `_`/`%` trong id (do người dùng đặt) là wildcard của LIKE. Đổi sang so sánh prefix bằng `substr(key,1,?) = ?`, không cần escape.
- **`TABLES.apiKeys` thiếu 5 cột của migration 004** (`allowedModels`, `monthlyBudgetUsd`, `rateLimitRpm`, `expiresAt`, `lastUsedAt`) → `syncSchemaFromTables` không tự lành được. Đã khai báo, và `SCHEMA_VERSION` bump lên 5 (test `data-repair-regression` bắt `latestVersion() === SCHEMA_VERSION`).
- **Connection của 4 provider đã gỡ vẫn còn trong DB bản nâng cấp:** thêm migration `005-retire-removed-providers` — chỉ `isActive = 0`, **không xóa**, giữ nguyên credential trong cột `data` để còn khôi phục; idempotent.
- **Test suite đỏ ngẫu nhiên:** `force-stream-config` và `office-client-content` trượt timeout 5000ms khi chạy cả suite rồi pass khi chạy lẻ hoặc chạy lại; `known-fails.txt` đang rỗng nên `qa-gate` tính mọi failure là regression. Đặt `testTimeout`/`hookTimeout` = 30000ms trong `tests/vitest.config.js` (không dùng retry để khỏi che hang thật).
- **Sửa thêm:** 6 module orphan `src/lib/oauth/services/{claude,codex,openai,qwen,antigravity,github}.js` import `getServerCredentials` từ `../config/index.js` (không tồn tại, hàm không được định nghĩa ở đâu trong repo) — không nằm trong build graph nên im lặng, ai import là sập; đã xóa (1119 dòng dead code). `clientDetector.js` vẫn map client `gemini-cli` sang provider id đã gỡ nên mất passthrough lossless → đổi sang `antigravity`. `LatencyCachePanel` dùng token `bg-bg-subtle` không tồn tại làm thanh cache-hit vô hình → `bg-bg-alt`. Dọn field chết `ollamaHostUrl`, guard prefix `gemini-cli/` trong `models/test/ping.js` + `CompatibleModelsSection.js`, comment `ollama-local` lỗi thời trong `providers/[id]/models/route.js`, và `open-sse/AGENTS.md` còn ghi `shared/qoder/` + `services/qoderModels.js`.


## 0.10.1 - 2026-08-22

### Removed

- **4 provider bị loại khỏi registry:** `gemini`, `gemini-cli`, `qoder`, `ollama-local` (registry còn 28 providers). Toàn bộ executor riêng, OAuth flow, usage fetcher, model resolver, nhánh validate/test API và UI liên quan được dọn sạch; route `/api/tags` (static ollama tag list) xoá theo. Model `gemini-*` giờ route về `antigravity`. Translator format `gemini`/`gemini-cli` giữ nguyên vì antigravity vẫn dùng chung pipeline.
- Client từng cấu hình 4 provider này cần trỏ lại connection mới (không có migration — dữ liệu connection cũ không tự chuyển đổi).

### Added

- **Connection health prober:** background sweep kiểm tra connection đang bật, kết quả phục vụ qua `GET /api/health/probe`; panel Latency/Cache mới trên trang Endpoint (`LatencyCachePanel`) + `GET /api/usage/cache` và `GET /api/usage/latency`.
- **Usage alerts:** cảnh báo ngân sách virtual key vượt mốc 50/80/100% và spike chi tiêu provider (giờ gần nhất > 4× trung bình 24h) qua stats emitter; banner trên dashboard + Windows toast bật/tắt được trong Profile (`src/sse/services/usageAlerts.js`).

### Fixed

- `usageAlerts.js` import sai nguồn (`getApiKeys`/`getKeySpendMapUsd`/`getSettings` phải lấy từ barrel `@/lib/db/index.js`) — trước đó build warning và alert sẽ lỗi runtime.
- Bump version lên 0.10.1 (trước đó quên bump nên UI vẫn hiện 0.10.0).

## 0.10.0 - 2026-08-22

### Changed

- **Một surface gateway duy nhất `/v1`:** gỡ hẳn 3 surface client còn lại — xoá rewrite `/codex`, `/responses`, `/v1beta` trong `next.config.mjs` và xoá thư mục route `src/app/api/v1beta/` (Gemini generateContent native). `dashboardGuard.js` chỉ còn public prefix `/v1`; gọi `/codex` hay `/v1beta` (remote lẫn loopback) giờ nhận 404 từ Next vì surface không còn tồn tại. Riêng đường `/api/v1*` trực tiếp vẫn bị chặn 403 "local-only" từ xa như cũ.
- **Codex CLI không đổi cách cấu hình:** trang CLI Tools vẫn ghi `base_url = <origin>/v1` + `wire_api = "responses"` vào `~/.codex/config.toml` — Codex CLI nói Responses API qua `/v1/responses` (route có sẵn), không cần alias riêng.
- **Card Base URLs tách 2 hàng trên cùng surface `/v1`:** hàng OpenAI-compatible (chat/completions · responses · models) và hàng Anthropic Messages (`/v1/messages`, kèm cảnh báo Claude Code/SDK phải trỏ base KHÔNG kèm `/v1`) + group Office (flag riêng). Header Google (`x-goog-api-key`, `?key=`) vẫn được accept trên `/v1`.

### Breaking

- Client gọi Gemini-native (`/v1beta/models/{model}:generateContent`) hoặc alias cũ (`/codex`, `/responses`) phải trỏ lại về `/v1`. Connection/provider Gemini bên trong gateway **không bị ảnh hưởng** — chỉ đổi chỗ client gọi vào.

## 0.9.0 - 2026-08-21

### Added

- **Export CSV lịch sử usage:** `GET /api/usage/export` tải toàn bộ usageHistory dưới dạng CSV (UTF-8 BOM — Excel mở tiếng Việt đúng), hỗ trợ filter `provider`, `model`, `startDate`, `endDate`; API key luôn xuất dạng masked. Nút **CSV** trên trang Usage xuất theo period đang chọn (Today/24h/7D/30D/60D).
- **Test All Connections:** nút toàn cục trên trang Providers chạy batch test mọi connection đang bật (OAuth + Free + API key + Compatible) qua `/api/providers/test-batch` mode `all`, tái dùng modal kết quả sẵn có.

### Changed

- **Một bề mặt gateway duy nhất:** bỏ `/api/v1` và `/api/v1beta` khỏi danh sách public trong `dashboardGuard.js` — từ xa gọi các path rewrite này nhận 403 "local-only", loopback vẫn hoạt động. Client chỉ cần nhớ `/v1/*`, `/v1beta/*`, `/codex/*`. Self-call nội bộ (model test ping) chuyển sang `/v1/chat/completions`.

## 0.8.0 - 2026-08-21

### Added

- **Virtual API Keys:** mỗi khóa con giờ có chính sách riêng — allowlist model/combo, ngân sách tháng (USD), giới hạn RPM (sliding window 60s) và thời hạn hiệu lực. Gateway trả 403/402/429 với thông điệp tiếng Việt khi vi phạm; lỗi hạ tầng đọc policy fail-open để không chặn chat.
- **Trang quản lý Virtual Keys** (`/dashboard/virtual-keys`): bảng khóa với mask/reveal/copy, KPI strip kiểu workbench, dialog tạo/sửa cho phép chọn model từ `/v1/models`, key đầy đủ chỉ hiển thị đúng 1 lần lúc tạo.
- **Analytics theo khóa:** `/api/keys` trả kèm `spentUsd` (tổng chi tiêu tháng từ usageHistory qua fingerprint); tab Request Details của trang Usage lọc được theo virtual key; thanh tiến độ ngân sách trên từng khóa.
- **Migration 004 `api-key-policies`:** thêm cột `allowedModels`, `monthlyBudgetUsd`, `rateLimitRpm`, `expiresAt`, `lastUsedAt` vào bảng `apiKeys` (nullable — khóa cũ hoạt động như cũ). Export/import DB giữ nguyên policy.

### Changed

- `POST /api/keys` nhận policy lúc tạo; `PUT /api/keys/[id]` cập nhật được từng trường policy (trước đây chỉ `isActive`).
- Sidebar nhóm Providers & Models có mục mới "Virtual Keys".
- **Thống nhất một giao diện Minimal:** tháo dỡ toàn bộ hệ design-preset (Classic/Minimal/Vivid/Soft/Workbench + DesignSwitcher) — Minimal được nấu thẳng vào token gốc (`globals.css` giảm ~320 dòng): light neutral sáng, dark GitHub-style `#0d1117`, accent xanh dương trầm; menu Header chỉ còn Sáng/Tối. Font icon subset lại (152 glyph).
- **VI hoá trọn bộ UI còn sót:** combos (strategy/empty state/actions), Usage → Request Details (bộ lọc + toàn bộ bảng), profile (câu trạng thái động), tray Windows (menu + balloon tiếng Việt, file encode UTF-8 BOM để PowerShell 5.1 đọc đúng dấu); test render endpoint cards cập nhật khớp chuỗi mới.


## 0.7.1 - 2026-08-14

### Performance

- **Hot-path TTFT:** process cache for `getSettings()` (invalidate on write); short TTL list cache for `getProviderConnections` (invalidate on every connection/node write and `importDb`).
- **Account selection:** global selection mutex replaced with **per-provider** locks so concurrent requests to different providers no longer serialize.
- **Sticky round-robin:** `lastUsedAt` / `consecutiveUseCount` updated in-memory first; DB persist is fire-and-forget so selection no longer awaits a full-row write before upstream.
- **Token refresh:** when the access token is still valid but inside the proactive lead window, refresh runs in the background (deduped per connection); only expired/missing-expiry hard cases still block the request. Same soft/hard split for GitHub Copilot tokens.

### Removed

- **GitLab Duo provider (`gitlab`):** registry, executor, OAuth UI/API, i18n, baselines, and drift list cleaned end-to-end (32 providers remain).

## 0.6.8 - 2026-08-09

### Fixed

- **Usage Logs tab:** added auto-refresh polling (~15s) so new requests appear while the tab stays open.
- **Endpoint page layout:** redistributed cards — API Keys + M365 Gateway side-by-side, Base URLs full-width below.
- **Basic Chat model list:** only show models from connections that actually have credentials; auth failures no longer fall back to the static catalog.
- **Quota Total Accounts count:** now only counts active, credentialled connections.

## 0.6.7 - 2026-08-09

### Removed

- **Cavoti Provider:** completely removed the `cavoti` provider from the registry, handlers, services, and tests. The static imports, UI components, and fallback logic specific to Cavoti have all been cleaned up. The provider list now stands at 72 entries.

## 0.6.6 - 2026-08-08

### Fixed

- **Dashboard Layout:** refactored the Endpoint page `Gateway Status` grid spacing and forced `min-h-[300px]` / `min-h-[220px]` on Recharts charts within `UsageChart` / `Model Usage` to prevent white-space layout collapse when chart data is empty.

## 0.6.5 - 2026-08-08

### Fixed

- **Office Gateway Card tests:** updated `endpoint-cards.render.test.js` to align with the simplified OfficeGatewayCard layout, removing obsolete card UI assertions that failed after the recent card restructuring.

## 0.6.4 - 2026-08-08

### Fixed

- **Claude for Office auxiliary requests:** the Office model catalog is now
  restricted to the configured `OFFICE_MODEL_IDS` allowlist. An Office request
  that uses a hidden or fixed helper-model ID outside that allowlist is routed
  through the first allowed combo without mutating the Office-owned request
  captured by the gateway. This prevents the add-in's parallel
  `claude-haiku-4-5` request from failing independently with Zyloo `402` while
  the selected `claude-sonnet-5` combo succeeds.
- **Office-only diagnostics:** completed Office streams now emit metadata-only
  `[OFFICE-SSE]` summaries containing model, event/block counts, tool name,
  argument byte counts, top-level JSON value types, and finish reason. Prompt,
  document, slide, tool-argument, and response content are never included.
- **Office raw-log isolation:** raw request/provider/response file logging is
  disabled for preserved Office requests even when global request logging is
  enabled.

## 0.6.3 - 2026-08-08

### Fixed

- **Claude for Office `AskUserQuestion` streaming:** the OpenAI-to-Claude
  response translator now emits one valid root JSON object for each tool input,
  including when an upstream restarts a function-argument snapshot after a
  broken prefix or appends malformed trailing data. Duplicate upstream terminal
  chunks are ignored so a completed tool JSON object cannot be replayed as
  adjacent JSON (`}{`) in the Office client.
- **Office payload preservation:** this release does not trim, summarize, or
  rewrite Claude for Office request content. The repair applies only to the
  mandatory protocol response conversion after routing to an OpenAI-compatible
  provider. Metadata-only `[TOOLJSON]` diagnostics record recovery without
  logging Office or tool content.

## 0.6.2 - 2026-08-08

### Fixed

- **Claude for Office `AskUserQuestion`:** OpenAI-compatible providers that
  repeat or cumulatively resend complete function-argument JSON while
  streaming no longer produce concatenated payloads. The Claude response
  translator now reconciles compatible JSON snapshots into one valid
  `input_json_delta`, preventing the client-side
  `Unexpected non-whitespace character after JSON` parse failure.

## 0.6.1 - 2026-08-08

### Fixed

- **Claude for Office PowerPoint execution:** added a gateway-owned Office.js
  safety constraint for PowerPoint shape traversal. Models are now instructed
  to load and inspect a shape type before obtaining a text frame, skip
  non-text shapes, and check `isNullObject` after `context.sync()`. This
  prevents a non-text shape from aborting a whole Office execution with
  `Shape.getTextFrameOrNullObject`.

### Changed

- **Lossless Office request policy:** `/office/v1/messages` now bypasses all
  optional content-altering transforms: RTK tool-result compression, PXPIPE,
  incompatible-modality stripping, remote-image prefetch conversion, model
  strip lists, Claude-tool deduplication, and provider-level thinking
  overrides. The Claude/OpenAI protocol conversion remains, because the
  configured Zyloo upstream requires it; Office-provided system context,
  history, attachments, tools, and tool results are otherwise retained.

## 0.6.0 - 2026-08-08

### Changed

- **Office gateway prompt profile:** requests to `/office/v1/messages` now skip
  the Caveman and Ponytail style-prompt injections. The global settings remain
  unchanged for every other gateway endpoint, provider, and combo route.
  This avoids adding style-only context to Claude for Office requests, which
  already carry task-pane-specific context.

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
