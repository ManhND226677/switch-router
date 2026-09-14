# Switch-Router Changelog

This file tracks changes for the local personal build only.

## Unreleased

### Changed

- **`stream_options` (cờ xin usage) nay có đường opt-out khai báo + kill-switch toàn cục.** Cờ này là extension riêng của OpenAI chat-completions; upstream nào validate schema chặt sẽ trả 400 thay vì bỏ qua field lạ. Hai đường thoát, không cần sửa code: (1) `SWITCH_ROUTER_STREAM_USAGE=off` tắt việc xin usage cho **mọi** provider ngay lập tức — đánh đổi là các request đó quay lại trạng thái không đo được, chứ không phải bị lỗi; (2) thêm `{ provider: "x", drop: ["stream_options"] }` vào `STRIP_RULES` (`open-sse/translator/concerns/paramSupport.js`) để opt-out theo từng provider. Để (2) hoạt động, `ensureStreamUsageRequested()` được gọi **trước** `stripUnsupportedParams()` trong `transformRequest()` — đảo thứ tự so với trước, hành vi không đổi vì hiện chưa rule nào drop field này. Chưa provider nào cần opt-out (OpenRouter/Kilo Code/Groq/DeepSeek đều chấp nhận cờ), nên đây là van an toàn chứ không phải fix.
- **Ẩn `/dashboard/errors` (Error Analytics) khỏi sidebar** — trang chỉ dùng cho debug; route vẫn giữ nguyên để mở trực tiếp bằng URL khi cần dò lỗi. Không đụng logic analytics phía sau.
- **Gỡ sạch CLI Tools Aizen và Hermes** khỏi dashboard (5 tool còn lại: Claude Code, Codex, OpenCode, Open Claw, Cowork — không đổi gì khác): xoá entry khỏi registry `src/shared/constants/cliTools.js` (trang tổng hợp và `[toolId]` tự 404 cho id đã gỡ), xoá `AizenToolCard.js`/`HermesToolCard.js` + exports trong `components/index.js`, nhánh case trong `ToolDetailClient.js`, API routes `api/cli-tools/aizen-settings` + `api/cli-tools/hermes-settings`, hai getter tương ứng trong batch `api/cli-tools/all-statuses`, lib `src/lib/aizenConfig.js` (kèm `AIZEN_SETTINGS_KEY`), test `aizen-config.test.js` và 2 image `public/providers/{aizen,hermes}.png`. Settings `aizenConfig` cũ trong DB không bị xoá (chỉ không còn ai đọc/ghi). Grep sạch: không còn tham chiếu `aizen|hermes` trong src/tests.
- **Gỡ hẳn 2 provider `kimi-coding` + `qwen`** (trước đây chỉ `hidden: true` nên vẫn còn trong codebase nhưng không hiện trên dashboard — đúng như phản ánh "nhiều provider bị xoá, không hiện trên web mà trong codebase vẫn còn"). Gỡ theo đúng pattern đã dùng cho `xai`/`cursor`/`commandcode`/`xiaomi-mimo` (0.10.9): xoá file registry `providers/registry/{kimi-coding,qwen}.js` + import, xoá `executors/qwen.js`, dọn executor/token-refresh (`executors/index.js`, `default.js` — `refreshKimiCoding` + hook `buildKimiHeaders`, `tokenRefresh.js`, `tokenRefresh/providers.js`, `services/usage.js` + `usage/misc.js` — `getQwenUsage`), dọn OAuth plumbing (`config/appConstants.js` — `OAUTH_ENDPOINTS.qwen`, `oauth/providers.js`, danh sách PKCE trong route `api/oauth/[provider]/[action]`, `OAuthModal`), dọn models route (`resolveQwenModelsUrl` + branch `qwen`) và `testUtils.js`. Thêm **migration 009 `retire-removed-providers`** (SCHEMA_VERSION 8 → 9): CHỈ tắt (`isActive = 0`) mọi connection cũ của 2 id này, không xoá — token OAuth nằm trong cột `data`, xoá là mất quyền truy hồi; idempotent như 005/006, export `RETIRED_PROVIDERS` để test dùng chung thay vì hardcode. `scripts/qa-provider-drift.mjs` kiểm tra chéo: `kimi-coding` vào `REMOVED_LIST`, còn `qwen` cố ý KHÔNG vào vì `"qwen"` vẫn là thinking-format hợp lệ trong `capabilities.js`. Lưu ý `kimi` (API key, Moonshot) là provider riêng — không đụng tới. Baseline test (`providers`/`alias`) và golden snapshot cập nhật; `qa-provider-drift` → OK (25 provider), test suite 1175 pass.

### Added

- **Thêm provider `unstoppable` (Unstoppable Code / Canopy Cloud) — endpoint AI phục hồi từ app desktop, login qua OAuth PKCE + nhập API key thủ công.** Unstoppable không có public API doc; toàn bộ cấu hình được dịch ngược từ installer `unstoppable-code-1.5.0-win-x64.exe` (NSIS → 7z → `app.asar` → `@electron/asar` extractAll, 13.5k file). Phát hiện: app proxy Claude Code qua cloud gateway `https://app.unstoppable.ai` — route `/api/v1/llm-proxy/anthropic` chấp nhận đúng `/v1/messages` + `/v1/messages/count_tokens` (query `beta=true`), forward các header `anthropic-beta`/`anthropic-version`/`user-agent`/`x-stainless-*`; upstream nhận `Authorization: Bearer <cskToken>` trong đó cskToken **chính là** API key của account (xác nhận trong `Stn()`: `cskToken: t` với `t = apiKey.trim()`). Vậy transport dùng `format: "claude"`, baseUrl `.../llm-proxy/anthropic/v1/messages`, `passthroughModels: true` (catalog model động theo plan, app fetch runtime nên không hardcode được), `timeoutMs: 120000` vì cloud aggregator xếp hàng lâu giống OpenRouter. **Phần login** dùng OAuth flow riêng của app: `GET /desktop-auth` (PKCE S256, params `state`/`code_challenge`/`redirect_uri`/`client_name`/`client_device_id`/`client_version`/`client_hostname` — không có `client_id`) rồi `POST /api/v1/desktop-app/desktop-auth/token` với **JSON body camelCase** (`grantType`/`codeVerifier`/`redirectUri`/`clientName`/`clientDeviceId`/...) thay vì form oauth2 chuẩn — nên cần handler riêng trong `oauth/providers.js` (`prepareConfig` sinh device id/version/hostname runtime, `buildAuthUrl`, `exchangeToken` JSON, `mapTokens`) thay vì đi đường generic. **Đường nhập API key thủ công**: app desktop本身 có field "paste API key" (`settingsValidateCanpyCloudApiKey`) cho cùng cskToken đó, nên khai báo `authModes: ["oauth","apikey"]` + `hasOAuth: true` → dashboard tự render cả hai nút (UI dual-auth generic), Pro user có sẵn key bỏ qua được vòng PKCE. `category: "oauth"` khiến nút login mặc định đi OAuth modal. Test connection probe `/api/v1/desktop-app/account` (không tốn inference quota) — bổ sung cả nhánh apikey trong `testApiKeyConnection` (trước đó rơi vào default "Provider test not supported"). Files: `registry/unstoppable.js` + import `registry/index.js`, `oauth/constants/oauth.js` (`UNSTOPPABLE_CONFIG`), `oauth/providers.js`, `testUtils.js`, test mới `unstoppable-provider.test.js` (7 case: registration/UI category/dual auth modes/fallback models/auth URL building/camelCase exchange body). Baseline `providers`/`alias`/`oauth-urls` + golden snapshot `buildUrl`/`buildHeaders` re-snapshot; test suite 1226 pass (1 fail pre-existing `export-db-masking` do `describe.sequential` API vitest, không liên quan). Verify live: `/.well-known/unstoppable-code` HTTP 200 + capability `llm-proxy-v1`; endpoint `/api/oauth/unstoppable/authorize` sinh đúng auth URL với đủ param Unstoppable; `/api/providers/unstoppable` trả 404 "Connection not found" = route nhận ra provider, chỉ chưa login. Lưu ý: chưa verify live token (cần user chạy login lần đầu).

- **Heartbeat log cấp process (`gateway-heartbeat.js`) — trả lời được câu "lúc đó server có sống không?".** Sự cố 2026-09-14 (gateway không ghi gì từ 06:12→17:59) không thể chẩn đoán sau khi xảy ra: WAL 988KB không được checkpoint chỉ chứng minh process **không tắt graceful**, còn log im lặng thì không phân biệt được "process chết" với "không có traffic". Heartbeat được start từ `custom-server.js` (entry point của process, không phải từ app Next) nên chạy ngay lúc boot và **không phụ thuộc traffic** — mất một khoảng giữa hai dòng heartbeat nghĩa là process không sống trong khoảng đó. Mặc định 5 phút (`SWITCH_ROUTER_HEARTBEAT_MS` để đổi, sàn 10s chống gõ nhầm gây spam log; `SWITCH_ROUTER_HEARTBEAT=off` để tắt), timer `unref()` nên không giữ process sống. Dòng log kèm `pid`, uptime, RSS và timestamp ISO để đối chiếu. Cố ý **không** đăng ký handler `SIGINT`/`SIGTERM`: đăng ký sẽ thay thế hành vi terminate mặc định của Node nên handler chỉ-log sẽ giữ process sống khi tray bấm stop, còn handler gọi `process.exit()` sẽ chặn route shutdown graceful sẵn có — khoảng trống heartbeat đã đủ trả lời, không cần đánh đổi đó. Verify trên process thật: 3 dòng `alive` cách nhau 15s khi hạ interval tạm thời, rồi trả về mặc định 5m.
- **Thêm provider `novita`** (OpenAI-compatible, `https://api.novita.ai/openai/v1`, connection dạng API key qua `DefaultExecutor`). `registry/novita.js` + `providers/novita.js` (bảng pricing snapshot theo đúng provider ID để thắng canonical/pattern pricing — catalog, khuyến mãi và free-tier của Novita đổi độc lập với tên model) + `services/usage/novita.js` (handler credit). Thêm luôn `services/providerModels.js`: gộp logic resolve model-list đang bị lặp ở route `providers/[id]/models` và `v1/models` về một chỗ nên hai mặt API trả cùng catalog. `capabilities.js` bổ sung pattern family của Novita; baseline `alias`/`providers` re-snapshot; `validate` route nhận id `novita`. Test: `workbuddy-novita-provider.test.js` (catalog, thứ tự ưu tiên pricing, parse usage).
- **Ẩn API key nội bộ khỏi danh sách/picker (`apiKeys.isHidden`).** Key nội bộ sinh ra cho model probe và gateway enforcement trước đây hiện lẫn trong danh sách key và trong các ô chọn key của dashboard. **Migration 008 `api-key-hidden`** thêm cột `apiKeys.isHidden` (`INTEGER DEFAULT 0`, key cũ giữ nguyên hiển thị); `apiKeysRepo.getApiKeys()/getApiKeyById()` nhận `{ includeHidden }`, mặc định loại key hidden nhưng key hidden vẫn hiệu lực đầy đủ khi enforce; `models/test/ping` đi đường key nội bộ nên probe không gãy. Test: `observed-usage-connection.test.js` (mới), `db-sqlite-vs-lowdb` (+8).
- **Tự động check-in hằng ngày cho WorkBuddy (`WorkBuddyCheckin`).** WorkBuddy chạy check-in theo mùa/chiến dịch: `POST /billing/meter/checkin-status` trả trạng thái season (`active`, `daily_credit`, `today_checked_in`, streak) và `POST /billing/meter/daily-checkin` nhận điểm của ngày — cả hai dùng thẳng session token của connection (endpoint khôi phục từ `app.asar` app desktop, test live 2026-09-12; hiện chưa có season nào mở nên claim trả 400 code 10001 "签到活动未开启或已过期"). Scheduler mới `src/shared/services/workbuddyAutoCheckin.js` theo pattern quotaAutoPing: tick 30 phút (timer `unref`, stop trong shutdown route, không start khi build/test, kill-switch env `WORKBUDDY_AUTO_CHECKIN=off`); mỗi tick quét các connection `workbuddy` active, đọc status có throttle idle 4h (chỉ tick dày khi season đang mở mà chưa điểm danh hôm đó), tự claim khi season bật, refresh token qua `refreshAndUpdateCredentials` khi gặp 401/403 rồi thử lại 1 lần, và chỉ log khi trạng thái đổi. Scheduler tự kích hoạt khi có traffic workbuddy (chat handler + dispatch usage), không start chỉ vì mở dashboard. State mới nhất được expose qua `getWorkbuddyUsage` (`checkin` trong response) và hiển thị thành row "Daily check-in" trên bảng quota (ẩn cho tới khi scheduler chạy lần đầu). Test: `workbuddy-auto-checkin.test.js` +7 case (claim/checked-in/idle throttle/retry claim 10001/refresh 401/no-session/no-timer-trong-test).

### Fixed

- **Login Unstoppable báo "Unable to connect desktop app. Return to Unstoppable Code Desktop and try again" — `redirect_uri` gửi sai cả host lẫn path.** Trang `app.unstoppable.ai/desktop-auth` không phải OAuth authorize generic: hàm `parseDesktopAuthParams` trong chunk client của web app **allowlist `redirect_uri` bằng regex** `^http://127\.0\.0\.1:([1-9][0-9]{0,4})(?:/desktop-connect|/canopy-cloud/oauth/callback)$` (port phải 1–65535). Không khớp → parse trả `null` → trang không thể tiếp tục và render thông báo trên. Đối chiếu: `http://localhost:28701/callback` (cũ) **fail**, `http://127.0.0.1:28701/callback` **fail** (sai path), `http://localhost:28701/canopy-cloud/oauth/callback` **fail** (sai host) — chỉ `http://127.0.0.1:28701/canopy-cloud/oauth/callback` **pass**. Đối chiếu chéo với chính app desktop: `buildAuthUrl` (`ywr`) và token exchange (`mwr`) trong `app.asar` trùng khít param/field đã implement, và loopback guard (`wwr`) cũng chỉ nhận `protocol==="http:"`, `hostname==="127.0.0.1"`, `pathname==="/canopy-cloud/oauth/callback"`, `Host: 127.0.0.1:<port>`. Fix 3 lớp: (1) `OAuthModal.js` thêm nhánh `provider === "unstoppable"` → `redirectUri = http://127.0.0.1:${appPort}/canopy-cloud/oauth/callback` (nhánh `codex` và generic `/callback` giữ nguyên), đồng thời placeholder URL trên modal đổi theo provider; (2) tách logic relay của trang callback ra component dùng chung `src/shared/components/OAuthCallback.js` (postMessage tới cả `localhost` lẫn `127.0.0.1` cùng port + BroadcastChannel + localStorage) rồi mount ở **hai** route: `/callback` (generic, re-export component chung — bỏ 135 dòng trùng) và `/canopy-cloud/oauth/callback` (Unstoppable); (3) registry `unstoppable.js` đổi `oauth.callbackPath` từ `/callback` → `/canopy-cloud/oauth/callback` cho khớp. Verify live: `/api/oauth/unstoppable/authorize` sinh `redirect_uri=http%3A%2F%2F127.0.0.1%3A28701%2Fcanopy-cloud%2Foauth%2Fcallback`; cả hai route callback trả HTTP 200 (bản đầu dùng `export { X as default } from` trỏ vào named export không tồn tại → 500 "Element type is invalid", sửa thành import default rồi re-export). Baseline `providers`/`alias`/`oauth-urls` byte-for-byte equal; `qa-provider-drift` OK (26 provider); `check-data-integrity` 0 error; test suite 1215 pass. Lưu ý: chưa verify được token thật (cần user restart tray + login lại trên dashboard).
- **Model free `openrouter/nex-agi/nex-n2.5-pro:free` "gọi không được" dù key đã thêm model — connect timeout 15s giết chết mọi attempt trước khi upstream kịp trả.** Tri giác sai từ đầu: key `MyCowork` có model trong `allowedModels` và `isActive=1`, không phải lỗi auth; `outboundProxyEnabled=false`, không phải proxy; `https://openrouter.ai` từ shell trả HTTP 200 trong 1s, không phải mạng. Gốc: OpenRouter là aggregator, model free xếp hàng upstream rất lâu trước byte đầu — đo 6 call liên tiếp (tất cả HTTP 200): **9s, 15s, 29s, 49s, 100s, 115s**. Trong khi đó `FETCH_CONNECT_TIMEOUT_MS` mặc định **15s** (abort nếu chưa nhận response headers) biến mọi attempt thành 502 "fetch connect timeout", fallback cũng timeout, rồi `ROUTING_DEADLINE_MS` 45s kết thúc request; 3/4 connection bị mark `testStatus:"unavailable"` + `modelLock_nex-agi/nex-n2.5-pro:free`. Fix: thêm `timeoutMs: 180000` vào transport registry openrouter (`open-sse/providers/registry/openrouter.js`) — `base.js` đã đọc `this.config?.timeoutMs`, chỉ thiếu giá trị khai báo. 180s bao phủ đuôi phân phối đã đo và vẫn chặn được upstream chết thật; không bật env toàn cục vì sẽ làm mọi provider khác đợi 120s khi upstream của chúng chết. Verify: fix có trong standalone build (`timeoutMs:18e4` trong 2 chunk); HTTP 200 trong 10.2s; 4/4 connection tự phục hồi `active` (cơ chế `clearAccountError` lazy-clean lock hết hạn khi rotation đi qua). Test suite 1205 pass / 0 fail.
- **Mỗi lần tray khởi động lại server là xoá sạch stdout/stderr log — heartbeat mất giá trị ngay sau restart đầu tiên.** `Start-Process` trong Windows PowerShell 5.1 không có `-Append` cho `-RedirectStandardOutput/-RedirectStandardError`, nên `Start-Router` (`scripts/windows/lib/router-runtime.ps1`) ghi đè hai file log thay vì nối tiếp. Heartbeat vừa thêm ở trên trở nên vô dụng đúng lúc cần nhất: một gap giữa hai dòng `[heartbeat] alive` chỉ còn nghĩa nếu các dòng trước nó sống sót qua restart (log production 2026-09-14 chỉ còn 517 byte / 1 boot sau khi tray restart lúc 19:33Z). Fix: thêm `Rotate-RouterLog` — trước khi launch, `Move-Item` log cũ sang `switch-router-production.out.<yyyyMMdd-HHmmss>.log` (cộng số thứ tự nếu hai boot cùng giây), prune giữ 10 archive mới nhất mỗi stream, lỗi archive/prune không bao giờ chặn startup. Boot mới nhất luôn vào tên file canonical nên những thứ vẫn đọc `switch-router-production.out.log` không gãy. Verify trong sandbox: 3 archive cũ + 2 log gốc, `Keep=2` → đúng 2 archive còn lại mỗi stream, nội dung log cũ nguyên vẹn trong archive, không warning; fix luôn nhánh pipeline rỗng (`@() | Remove-Item` ném "missing path operand" — trường hợp bình thường ngay sau boot đầu tiên).
- **`requestDetails.tokens` 0/0 khi không đo được usage nay được đánh dấu, không còn lẫn với response 0-token thật.** Sau fix `usageHistory` ở dưới, hai bảng mô tả cùng một tình trạng bằng hai cách khác nhau: `usageHistory.meta.usageMissing = true` còn `requestDetails.tokens` chỉ là `0/0` trần — không phân biệt được "không đo được" với "thật sự dùng 0 token", trong khi màn hình Usage cộng dồn chính các row đó. Thêm `isUsageMissing(tokens)` vào `open-sse/handlers/chatCore/requestDetail.js` (đọc cả cách đặt tên OpenAI `prompt_tokens`/`completion_tokens` lẫn Claude `input_tokens`/`output_tokens`; key đúng định dạng thắng kể cả khi bằng 0), dùng lại trong `saveUsageStats()` để hai bảng không lệch định nghĩa, và `buildRequestDetail()` nhận cờ `usageMissing` → chỉ gắn vào object khi `true`. Bốn điểm ghi **terminal** truyền cờ này (`streamingHandler`, `nonStreamingHandler`, `sseToJsonHandler` ×2). Cố ý **không** suy ra cờ từ `tokens` bên trong `buildRequestDetail`: row placeholder ghi lúc stream còn đang chảy cũng 0/0 theo thiết kế, suy diễn sẽ gắn cờ cho mọi request streaming.
- **Request streaming thành công (HTTP 200) không bao giờ vào `usageHistory`/`usageDaily` — Usage/Stats đứng im dù Request Details vẫn ghi.** Ba lớp chồng nhau: (1) `open-sse/executors/default.js` không gắn `stream_options.include_usage` nên upstream OpenAI-compatible (OpenRouter/Kilo Code) không trả usage ở chunk cuối — `transformRequest()` nhận thêm `(model, body, stream, credentials)`, thêm `ensureStreamUsageRequested()` chỉ áp cho format OpenAI và bỏ qua `claude/gemini/antigravity/ollama/openai-responses/grok-web`, ưu tiên `credentials.runtimeTransport.format` để provider multi-endpoint (glm/kimi/minimax/stepfun) không bị gửi cờ sang nhánh Claude; (2) `open-sse/utils/stream.js` — chunk `finish_reason` inject estimate (+2000 buffer) rồi `mergeUsage()` max-merge làm estimate **đè mất usage thật** (753/16 lưu thành 2122/16), nay có cờ `usageEstimated` để usage do provider trả **thay thế** estimate; (3) `open-sse/handlers/chatCore/requestDetail.js` — `if (inTokens === 0 && outTokens === 0) return;` bỏ luôn request đã trả 200, nay vẫn ghi row với token 0 và đánh dấu `meta.usageMissing` để phân biệt với response 0-token thật; `usageRepo.persistUsageEntry()` persist `entry.meta` (trước luôn ghi `{}`). Bug lặp lại từ 2026-09-11. Verify E2E trên build mới: request `kc/nex-agi/nex-n2.5-pro:free` → `usageHistory` 6456→6457, `usageDaily[2026-09-14]` 3→4, row `promptTokens=758` (không phải ~2758), `meta={}`; dashboard `/api/usage/request-logs` trả row mới nhất. Test mới `tests/unit/streaming-usage-persistence.test.js` (5 case, **fail 5/5 trên code cũ**).
- **Toggle observability trong Settings vô hiệu + lỗi ghi request-detail bị nuốt silent.** DB thật tồn tại **hai key ngược nhau** (`enableObservability:true` do dashboard ghi, `observabilityEnabled:false` do build cũ để lại) nên trạng thái phụ thuộc key nào được đọc; `getObservabilityConfig()` còn `catch {}` trần, lật observability về OFF không để lại dấu vết nào — một lỗi đọc settings thoáng qua trông y hệt "app ngừng ghi log". Fix: `settingsRepo.sanitizeSettingValues()` fold legacy key rồi xoá (chỉ khi canonical vắng mặt, nên DB chỉ có key cũ vẫn giữ nguyên giá trị) → hai key không thể lệch nhau nữa; `requestDetailsRepo.readStoredObservabilityFlag()` thống nhất thứ tự ưu tiên `enableObservability` → `observabilityEnabled` → `enableObservability2` → default `true`, cảnh báo 1 lần khi phát hiện xung đột và 1 lần khi bị tắt; kill-switch `OBSERVABILITY_ENABLED` nhận `false/0/off/no` (case-insensitive); catch giữ config tốt gần nhất thay vì tắt; batch write fail thì re-arm timer để batch đã requeue không nằm chờ vô định trong memory tới request kế tiếp. Ba log lỗi ghi usage nay có prefix `[usageRepo]` để grep được.
- **WorkBuddy hiện "NA" ở quota dù account còn credit — endpoint credit cũ sai loại token.** `getWorkbuddyUsage()` gọi `https://www.workbuddy.cn/openapi/v2/credit` (Open Platform) nhưng credential của connection là JWT Keycloak realm `copilot` của chat plane → upstream trả 401 "access token signature verification failed" → service rơi vào `permission_required` với mọi giá trị null → UI hiển thị NA; schema `total_capacity_size/used` trong test là mock chưa từng chạy thật. Endpoint thật được phục hồi từ `app.asar` của app desktop WorkBuddyAI (cùng đường app dùng cho panel credits): `POST https://www.workbuddy.ai/billing/meter/get-user-resource-summary` — chấp nhận trực tiếp accessToken hiện có, trả `data.Packages[]` với `CycleTotalCapacity/CycleUsedCapacity/CycleRemainCapacity/CycleFrozenCapacity` + `CapacityUnit` (ghi lộn xộn "credit"/"credits"). Verify live 2 account: một account 100/100 credit, account kia 3 gói (gift 250 hết, activity còn 79.56, trial 100 hết). Fix: service chuyển sang endpoint mới (POST, body `{}`), gộp toàn bộ gói có unit `credit(s)`, làm tròn 2 số thập phân để cắt nhiễu float upstream ("290.43999986"), `remaining = Σ remain (fallback total − used − frozen)`, giữ nguyên shape `native`/`quotas.credits` nên UI "Native credits" tự hoạt động lại; source đổi thành `workbuddy-billing-meter` (cả fallback trong `ProviderLimits/utils.js`). Test: `workbuddy-novita-provider.test.js` mock shape mới + endpoint pin (URL/method POST) + case gộp nhiều gói và làm tròn.

- **WorkBuddy (`wb/*`) fail 100% khi gọi qua router dù CLI gốc chạy được — router tự gửi `reasoning_effort:"auto"` không hợp lệ.** Log production 2026-09-11 21:01: `POST wb/deepseek-v4.1-flash · THINK:auto · 298 MSG · 108 TOOL` → `400 {"code":11150,"extError":{"code":"invalid_reasoning_effort"},"msg":"the reasoning effort value is not supported by the current model"}` trên 2 account. Gốc: `applyThinking()` nhánh `case "openai"` (`open-sse/translator/concerns/thinkingUnified.js`) gán thẳng sentinel nội bộ `"auto"` (từ `toLevel({mode:"auto"})`) vào `reasoning_effort` — `"auto"` không thuộc enum `reasoning_effort`, và executor WorkBuddy không lọc trường này nên gửi nguyên lên `/v2/chat/completions` để upstream validate theo model. CLI gốc không gửi field kiểu OpenAI này nên chỉ nó qua được. Fix 2 lớp: (1) nhánh `openai` bỏ hẳn field khi level resolve ra `auto` (giữ clamp `max→xhigh` và mọi level tường minh) — sửa luôn cho các provider target `openai` khác; (2) `normalizeWorkbuddyBody` xoá `reasoning_effort` tại ranh giới WorkBuddy (chat plane validate theo model, CLI gốc không gửi). Thinking vẫn hoạt động qua `reasoning_content` mặc định của model. Test: `thinking-effort-openai-max-clamp.test.js` +4 case, `workbuddy-channel-identity.test.js` +2 case. Lưu ý account lỗi kèm `403 code 11140` là credential desktop-app đã chết — cần re-OAuth trên dashboard, không liên quan fix này.

## 0.11.0 - 2026-09-05

### Changed

- **Gỡ nhóm tính năng không dùng (groups A+B) + thêm thẻ "Optional Features" trong Settings.** Landing, translator, console log, pricing API, auth/login và redirect aliases bị xóa bỏ; office gateway / pxpipe / MCP marketplace giữ lại nhưng toggle được, lưu DB-backed (`officeGatewayEnabled`/`pxpipeEnabled`/`mcpMarketplaceEnabled`), office seed một lần từ env. Registry/test fixture của provider đã gỡ được dọn theo (`scripts/qa-provider-drift.mjs` canh chậm tái xuất hiện).

### Security

- **SSRF guard cho `/api/providers/suggested-models`.** Route fetch URL do client truyền mà không kiểm tra — giờ gọi `assertPublicUrl()` trước `fetch`, URL nội bộ/private trả 400.
- **Virtual-key policy fail-closed.** Trước đây lỗi hạ tầng đọc policy bị nuốt và chat đi tiếp (âm thầm bỏ qua allowlist/budget/RPM/hết hạn); giờ trả 403 + log `AUTH`, không còn đường vòng quanh ràng buộc khóa ảo.
- **Thu hẹp CORS.** Bỏ `Access-Control-Allow-Origin: *` khỏi StepFun proxy (JSON/upstream passthrough) và `errorResponse()`; OPTIONS public của `/v1/*` giữ nguyên cho CLI/browser client.
- **Request logger redact body.** Bật `ENABLE_REQUEST_LOGS` trước đây ghi apiKey/token vào `logs/` ở body request lẫn `6_error.json`; giờ `redactSensitiveBody()` mask đệ quy `apiKey/api_key/token/accessToken/refreshToken/idToken/copilotToken` trước khi ghi (header đã redact từ 0.10.10).
- **MCP SSE unregister khi client ngắt đột ngột** — không còn rò session + tiến trình con npx.
- **Database export mask secrets/PII** (accessToken/refreshToken/idToken/apiKey/email) với sentinel-safe import; CLI token redact trong request log; database route value-check token thay vì chỉ check presence.
- **Chặn drive-by cross-site:** `Sec-Fetch-Site` khác same-origin/same-site/none bị từ chối; pxpipe vào nhóm local-only; gateway bind loopback-only (HOSTNAME bị override) + realtime relay WS re-check TCP peer/Origin.
- Vá toàn bộ npm audit vulnerabilities.

### Fixed

- **Stale errorCode trên connection khỏe.** `clearAccountError` return sớm ở 2 nhánh "nothing to clear" khiến errorCode treo vĩnh viễn (9 connection Ollama/OpenRouter/Vilao/Bai trong DB thật); giờ cả 2 nhánh đều null errorCode, kèm **migration 007** quét backlog (tiêu chí trùng `check-data-integrity`: `testStatus=active && lastError=null`, giữ errorCode của row "unavailable" — đó là diagnostics thật; SCHEMA_VERSION 7, tự backup trước khi migrate). Regression test trong `data-repair-regression.test.js`.
- **Timer rò rỉ:** unref debounce flush của requestDetailsRepo + pendingTimers của usageRepo; route shutdown giờ flush cả requestDetails, stop health prober + quota auto-ping scheduler.
- **UI:** class chết `animate-in zoom-in-95` (plugin không hề cài → dropdown không có hiệu ứng) thay bằng keyframe `pop-in` tự viết; Badge warning vàng→amber đồng bộ với toast; Sidebar bỏ `<h1>` trùng với Header; token `--color-danger/--color-success` sync về giá trị Tailwind đang dùng; `themeColor` theo prefers-color-scheme; `<noscript>` mở khóa icon khi JS tắt; `text-[8px]/[11px]` → `text-xs`; LatencyCachePanel có grid 1 cột trên mobile.

## 0.10.13 - 2026-08-30

### Fixed

- **Account chết credential (WorkBuddy 403 `code 11140`) không còn ám vòng rotation mỗi 2 phút.** Trước đây rule 403 cố định `COOLDOWN.long` 2 phút: credential hỏng (session desktop app bị revoke, cần re-OAuth) fail MỌI request nhưng cứ 2 phút lại được chọn lại, đốt 1 call upstream + hiện lỗi 403 mãi. Giờ `11140` có rule text riêng với `backoff: true` trong `ERROR_RULES` (`open-sse/config/errorConfig.js`): cooldown leo thang exponential theo `backoffLevel` (2s → 4s → … → cap 5 phút), vẫn rotate sang account khác, và `clearAccountError` reset level về 0 khi request thành công nên account re-OAuth xong tự phục hồi. Test `tests/unit/context-guard-fallback.test.js` +4 case.

### Changed (config runtime, không phải code)

- Vô hiệu hóa connection WorkBuddy desktop-app (11140 mọi payload từ 0.10.11) — bật lại sau khi bấm re-OAuth trên dashboard.
- Key `MyCowork` khóa `allowedModels` về `wb/hy4-preview` + 3 combo `claude-*`: client fallback gọi `bai/*`, `openrouter/*`, deepseek bare… bị chặn ngay ở gateway thay vì đốt 15–47s connect timeout rồi 404 guardrail.

## 0.10.12 - 2026-08-30

### Fixed

- **`wb/hy4-preview` vẫn 11128 từ Claude Code dù system prompt đã rewrite** (lỗi tái phát 20:53, requestId `6d9b3344…` đúng payload người dùng report). Fix 0.10.11 chỉ thay câu identity ở đầu **system** message; payload bị lỗi lần này `3 MSG` kèm một **assistant** message mang câu identity (flow ultra-effort/retry của Claude Code inject lại danh tính vào đó). Chốt nhân quả bằng 19 probe A/B live qua gateway: câu `You are Claude Code, Anthropic's official CLI for Claude` bị chặn khi đứng đầu system message hoặc xuất hiện **bất kỳ đâu trong assistant message** (kể cả giữa dòng — `Sure! You are Claude Code… How can I help?` cũng 11128); cùng câu đó trong user message, tool definitions, system giữa dòng, payload 90KB, 31 tools hay `thinking` xhigh đều pass. Fix: `WORKBUDDY_IDENTITY_REWRITES` thêm trường `roles` theo rule + rule assistant thay câu identity dạng substring (không anchor); `neutralizeChannelIdentity()` quét cả `role:"assistant"` (string lẫn text-block array, block không phải text giữ nguyên). User/tool content vẫn nguyên từng byte; provider khác không đụng. Test nâng từ 8 lên 12 case.

## 0.10.11 - 2026-08-30

### Fixed

- **`wb/hy4-preview` fail 100% khi gọi từ Claude Code CLI** (`400 {"code":11128,"msg":"Illegal API invocation from an unapproved channel"}`). Không phải hết promo, lỗi token, giới hạn kích thước hay payload tools: WorkBuddy AI sàng lọc **body** của `/v2/chat/completions` và chặn request mang danh tính CLI đối thủ. Số liệu từ usage DB: 15/15 payload bị chặn có system prompt mở đầu `You are Claude Code, Anthropic's official CLI for Claude…`, **0/168** payload thành công có chuỗi đó; 08-29 từng chạy payload 351KB bình thường. A/B call trực tiếp chốt nhân quả: body ~1KB (2 message, 2 tool) vẫn 11128 khi giữ câu identity, và qua gate ngay khi bỏ câu đó. Fix: `neutralizeChannelIdentity()` trong `open-sse/executors/workbuddy.js` thay đúng câu identity đầu system message bằng `You are an expert software engineering agent.` — rule đặt ở `WORKBUDDY_IDENTITY_REWRITES` (`open-sse/config/appConstants.js`), thêm rule mới không phải sửa code.
- **Giới hạn phạm vi + không phá harness của CLI.** Rule chỉ chạy trong executor `workbuddy`, chỉ đụng message `role:"system"`, chỉ câu đứng ở đầu dòng (cờ `m`) — tool definitions, tool names, message history và phần còn lại của system prompt giữ nguyên từng byte; `DefaultExecutor("bai")` vẫn gửi nguyên văn prompt Claude Code (test chốt). Rewrite theo kiểu copy-on-write: `base.js` gọi lại `transformRequest` trên **cùng một body object** cho mỗi URL/account/provider trong combo, nên mutate tại chỗ sẽ rò prompt đã rewrite sang upstream khác và vào request log. Test mới `tests/unit/workbuddy-channel-identity.test.js` (8 case).
- **Sửa chú thích cũ** ở đầu `workbuddy.js` diễn giải nhầm mã `11128` là "thiếu system prompt" — payload lỗi đều đã có system message làm đầu; viết lại thành 4 quirk tách bạch (forceStream, gate channel, prepend system, uid từ claim `sub`).

### Known issues (không đổi trong bản này)

- Connection WorkBuddy desktop-app (token desktop app) bị upstream chặn bằng `403 {"code":11140,"msg":"request illegal"}` với **mọi** loại payload, kể cả nhóm identity mà 168 request từng pass → cần bấm lại OAuth trên dashboard; không liên quan rewrite. Hai connection gmail vẫn probe OK.
- Router vẫn coi `400` là account chết (`src/sse/handlers/chat.js:457`) → rotate đủ cả 3 connection cho cùng một lỗi payload rồi log `all 3 accounts unavailable`, làm metric latency/failure rate sai bản chất. Không sửa vì đường này dùng chung mọi provider.

## 0.10.10 - 2026-08-30

### Security

- **Request logs che header nhạy cảm.** `maskSensitiveHeaders()` trong `open-sse/utils/requestLogger.js` trước đây là no-op (giữ nguyên mọi header theo chú thích "local behavior") — tức bật `ENABLE_REQUEST_LOGS=true` là plaintext `Authorization`/`x-api-key`/`Cookie` của client lẫn upstream nằm trong `logs/` (retention 7 ngày, full body kèm theo). Giờ redact `[REDACTED]` cho `authorization`, `proxy-authorization`, `x-api-key`, `api-key`, `cookie`, `set-cookie`; áp luôn cho header response provider (`logProviderResponse` trước đây không mask). Body và header còn lại giữ nguyên cho debug.

### Changed

- **Bớt rò payload ra stdout:** `streamHelpers.js` không in 100 ký tự đầu của SSE line lỗi (có thể chứa nội dung message user) — chỉ log độ dài; `oauth/codex/import-token` log `error.message` thay vì nguyên object error; log poll onboard `[ProjectId]` (lặp mỗi 2s) chuyển sang `dbg()` dev-only; `v1/models` đổi `console.log` → `console.warn`.

### Removed

- **Dead code dọn sau đợt gỡ 0.10.9** (quét 2 lớp: reference + dead export, xác nhận 0 tham chiếu trước khi xóa): import thừa `OAUTH_ENDPOINTS` (`tokenRefresh.js`), `proxyAwareFetch` (`tokenRefresh/providers.js`), `Badge`/`Input`/`AI_PROVIDERS` (trang provider detail), `generateState` (`oauth/providers.js`); export 0 tham chiếu `OPENAI_CONFIG` + `AWS_REGION_PATTERN`/`assertValidAwsRegion` (leftover provider AWS-based đã gỡ), `getProviderNames`, `GIT_DIFF_CONTEXT_KEEP`, `convertResponsesApiFormat` (file giữ lại `normalizeResponsesInput` đang dùng), `hasClaudeSignaturePrefix`, `writeStreamError`, `chatChunkSse`, trio `printSection`/`printKeyValue`/`printList` (`oauth/utils/ui.js` — giữ `spinner` đang dùng), re-export `BASE64_BLOCK_SIZE`/`decodeJwtPayload` (`providerHelpers.js` — vẫn dùng nội bộ).
- **4 icon mồ côi** `public/providers/{xai,cursor,commandcode,xiaomi-mimo}.png` (0 tham chiếu sau khi gỡ provider).
- **4 artifact JSON test-run cũ track nhầm trong git** (`tests/vitest-results.json`, `tests/__baseline__/{baseline,current}-results.json`, `tests/__baseline__/current.json`) — chỉ ghi lại kết quả vitest từ bản trước 0.10.9; CI (`qa.yml`) và `qa-gate`/`qa-profile` dùng `tests/.vitest-reports/` (không track).
- **Test `bugs-gemini-cursor-commandcode.test.js` đổi tên `bugs-gemini.test.js`** (nội dung đã sạch cursor/commandcode từ 0.10.9, chỉ còn tên file sai) + cập nhật `tests/translator/AGENTS.md`; `verify-alias.mjs` bỏ 5 token probe của provider đã gỡ (`commandcode`, `xai`, `cursor`, `mimo`, `xiaomi-mimo`) và regen `alias-baseline.json` (58 tokens).

## 0.10.9 - 2026-08-30

### Added

- **Tích hợp lại B.AI vào nhóm Free Tier.** `registry/bai.js` mới (id `bai`, category `freeTier` — vào đúng mục "Free Tier Providers" của dashboard nhưng vẫn dùng form nhập API key, khác category `free` dạng no-auth), upstream `https://api.b.ai/v1`, DefaultExecutor chuẩn OpenAI-compatible (non-stream + stream đều chạy, không có quirk). Probe 44/44 model bằng key thật (2026-08-30): đúng **6 model free** dùng được với key 0-balance (`hy3`, `glm-5.3-flash`, `deepseek-v4-flash`, `qwen3.8-flash`, `mimo-v2.5`, `deepseek-v4-flash-vision-exp`); 38 model còn lại premium (403 "Deposit required") hoặc trừ credit — chỉ list 6 model free trong registry, muốn dùng premium thì deposit rồi thêm custom model trên connection. Cả 6 đều trả `reasoning_content` kiểu OpenAI → `PROVIDER_CAPABILITIES["bai"]` khai `thinkingFormat: "openai"` (không inject field vendor-specific) + context/maxOutput theo family + `vision` cho biến thể `-vision-exp`. Logo `public/providers/bai.png` vẽ bằng script pure-Node (tile tím #7C5CFF + sparkle trắng, đúng hợp với icon `auto_awesome` đã chọn). Golden-url-header/request tự bắt provider mới (snapshot regen); live test qua gateway OK: non-stream `bai/hy3` + stream `bai/glm-5.3-flash`.

### Removed

- **Gỡ 4 provider khỏi registry: `xai`, `cursor`, `commandcode`, `xiaomi-mimo`.** Xóa 24 file riêng (4 registry entry, executor + translator 2 chiều của cursor/commandcode, `cursorProtobuf`/`cursorChecksum`, OAuth service + constants của xai/cursor, `CursorAuthModal`, 2 route `oauth/cursor/*`, 6 test dedicated), dọn toàn bộ tham chiếu trong file chung (executors/translator index, concerns, oauth `providers.js` + route `[provider]/[action]` về codex-only, `tokenRefresh`, UI trang provider + `dashboardGuard` + `providerNormalization`), `index.js` regenerate qua `scripts/generate-registry-index.mjs` (còn 25 provider). `grok-cli`/`grok-web` (cùng dòng xAI) và `xiaomi-tokenplan` giữ nguyên — provider riêng biệt; `refreshGrokCliToken` giờ tự refresh trực tiếp theo `oauth.refreshUrl`/`clientId` của grok-cli thay vì qua `XaiService` đã xóa. Baselines/snapshot golden regen; `qa-provider-drift.mjs` thêm 4 id vào REMOVED_LIST.
- **Migration 006 `retire-removed-providers`** (SCHEMA_VERSION 5 → 6): tắt (isActive=0, KHÔNG xoá — credential vẫn nằm trong cột `data` để truy hồi) các connection còn sót của 4 provider trên; idempotent, migrate.js tự chụp backup trước khi áp.

### Fixed

- **3 test source-contract fail tùy cwd:** `antigravity-project-required`, `model-ping-timeout`, `model-probe-mode` resolve repo root bằng `process.cwd()/..` — chỉ đúng khi chạy với cwd = `tests/` (như `npm test`); chạy vitest từ root thì ENOENT `D:\MyProject\src\...`. Giờ resolve từ vị trí chính file test qua `import.meta.url` nên pass ở mọi cwd.

## 0.10.8 - 2026-08-29

### Added

- **Error Analytics phân loại lỗi theo nguyên nhân (cause bucket).** Đọc từ `/api/usage/errors` cửa sổ 1000 request gần nhất: 115 lỗi nhưng chỉ ~6 nhóm nguyên nhân (quota 429 chiếm đa số, payload bug, context overflow, modality, auth/config, network, upstream) — trang lỗi trước đây chỉ liệt kê signature thô nên không trả lời được "sửa gì trước". Classifier mới `src/lib/db/helpers/errorBuckets.js` (pure, testable): rule message-pattern theo độ đặc hiệu trước, fallback theo status sau; `status 0` (không nhận được response nào = transport) → network, `null` → other. `getErrorAnalytics` trả thêm `buckets[]` (count + share, sort desc, phủ toàn bộ lỗi trong kỳ chứ không chỉ top-10 signature) và gắn `bucket` vào từng signature/recent row. UI `/dashboard/errors` thêm card **Errors by cause** (icon + bar + count + %) và chip bucket cạnh mỗi signature / lỗi gần đây. Test: `error-buckets` (24 case bằng chính message lỗi thật quan sát được), `error-analytics` mở rộng fixture mỗi bucket một ca.
- **Backpressure cho model dính 429 lặp lại.** Đo thật: `workbuddy/hy4-preview` ăn 45 lỗi/ngày vì giữa các `modelLock_*` ngắn (2s→5p, reset khi success) traffic vẫn dồn vào model đang rate-limit. Registry mới `open-sse/services/modelThrottle.js` (in-memory, fail-open, sống sót hot-reload qua `globalThis`): sliding window 5 phút, **3 lỗi 429 → model HOT**, cooldown 60s và tăng ×4 khi tái phạm trong 30p (60s → 4p → 16p, trần 30p); `resetsAtMs`/Retry-After của provider được tôn trọng làm sàn cho cooldown; success xóa throttle ngay. `chat.js` ghi nhận mọi 429 trong `onFailure` (probe `x-9r-probe` không ghi) và clear trong `onRequestSuccess`. `combo.js` tách model HOT khỏi rotation trước khi thử: combo chỉ phục vụ model sẵn; khi không còn model sẵn (hoặc tất cả ready fail) trả **429 + header Retry-After** (reset sớm nhất) thay vì đốt thêm request vào model đang nóng. Request trực tiếp một model giữ nguyên ngữ nghĩa hiện tại (client chỉ định rõ target), account lock `modelLock_*` không đổi cho ca chết hẳn. Test: `model-throttle` (11, fake clock: ngưỡng/window/escalation/Retry-After floor/expire/clear/partition) + `combo-backpressure` (4: skip HOT, all-HOT → 429 không tốn attempt, ready fail không đốt HOT, fallback thường nguyên vẹn).

### Fixed

- **Translator: gộp `tool_result` trùng per `tool_use_id`.** Lỗi 400 Anthropic `each tool_use must have a single result` lặp lại trên antigravity claude (8 lần/cửa sổ): client gửi trùng kết quả tool (2 message `tool` cùng `tool_call_id` hoặc block lặp trong cùng message) và pass merge same-role của `fixToolUseOrdering` gộp chúng vào một message → 2 `tool_result` cùng id. Thêm pass 3 dedupe trên toàn conversation: giữ block đầu per id, ưu tiên content không rỗng nếu block giữ rỗng. Test: 4 case trong `bugs-toClaude-context` (trùng 2 tool message, id khác nhau giữ nguyên, native Claude trùng trong 1 message, trùng khác turn).
- **CI regression gate fail vì snapshot phụ thuộc OS.** `golden-url-header` ghi `X-Msh-Device-Model: "win32 x64"` (header nhúng `process.platform + arch`) nên chạy trên CI Linux luôn lệch (`linux x64`) — fail từ trước bản này, không phải regression của 0.10.8. `sanitize()` trong test khử cặp platform/arch thành `<PLATFORM>` và regen snapshot; golden giờ deterministic trên mọi OS.

## 0.10.7 - 2026-08-29

### Added

- **Context guard — tự xử lý request vượt cửa sổ token.** Đo từ `requestDetails`: 4/115 lỗi gần nhất là overflow ngữ cảnh, tất cả `stepfun/step-3.7-flash`, mỗi lỗi mất 14–47s; upstream báo `maximum context length is 262144 tokens` trong khi `capabilities.js` khai 256000. Trước đây lỗi này rơi vào rule `{status:400, cooldownMs:0}` nên gateway **xoay hết mọi account của cùng model** (cùng cửa sổ token ⇒ chắc chắn fail lặp lại) rồi mới trả lỗi. Module mới `open-sse/context-guard/`: `errorUnwrap.js` bóc lớp JSON lồng nhau (StepFun encode `error.message` 3 tầng) và trích `maxContextTokens`/`inputTokens`/`requestedOutputTokens`; `shape.js` đọc cả 5 envelope dispatch (`messages[]`, `input[]`, `contents[]`, wrapper `request.contents` của antigravity, `instructions` của codex) và quan hệ producer/consumer của tool-call id; `budget.js` chọn cửa sổ theo độ tin (số upstream báo > metadata `declared` > từ chối cắt); `trimmer.js` bỏ dần group cũ nhất cho tới khi vừa, không bao giờ bỏ lượt user cuối / system / làm lẻ cặp `tool_use`–`tool_result`, và chỉ hạ `max_tokens` khi đã hết phần cắt được (estimate `chars/3` được hiệu chỉnh theo số token upstream tự báo). `chatCore.js` nối vào đường lỗi: cắt xong **thử lại đúng 1 lần trên cùng credentials** (không thể sinh fan-out mới) — tái dùng đúng pattern retry 401 sẵn có. Fan-out chặn ở tầng phân loại: `ERROR_RULES` thêm cờ `payloadFault`, `checkFallbackError` trả field này, `markAccountUnavailable` trả `shouldFallback:false` và **không ghi modelLock**; combo vẫn xoay model vì model sau có thể cửa sổ lớn hơn. Settings: `contextGuardEnabled` (mặc định BẬT — chỉ nhận diện/log), `contextAutoTrimEnabled` (mặc định TẮT vì cắt là xóa nội dung), `contextTrimMarginPct` (5, clamp 0–25); cưỡng tắt cho request Office; per-request `x-switch-router-context-trim: off|force`. `capabilities.js` thêm `contextWindowSource`/`maxOutputSource` = `declared|default` để không ai lấy floor 200k bịa ra sizing cho model custom/passthrough. Mọi response có guard tham gia mang `x-switch-router-context-trim: applied; dropped=N; before=…; after=…; budget=…` (hoặc `refused; reason=…`) + `Access-Control-Expose-Headers`; requestDetail ghi bản ghi `contextGuard`. Test: `context-guard-classify` (15), `context-guard-fallback` (13), `capabilities-provenance` (6), `context-guard-trimmer` (27), `context-guard-header` (9), `chatcore-context-guard` (8, integration qua `handleChatCore` với payload stepfun capture nguyên văn).

## 0.10.6 - 2026-08-29

### Removed

- **Gỡ provider B.AI** khỏi registry (hết FREE) — file `registry/bai.js` xóa, `index.js` regenerate qua `scripts/generate-registry-index.mjs`.
- **Xóa code rác:** module mồ côi `open-sse/transformer/responsesTransformer.js` (0 reference), 3 thư mục route rỗng, `build2.log`, log cũ trong `logs/`, dòng typo `product` trong `.gitignore`; `.script/check-imports.mjs` dời về `scripts/`.
- **Archive script one-off** vào `scripts/archive/` (migrate-registry, verify-additive-registry, injectDisplayToRegistry, check-combo-account, test-combo-autoswitch, compare-vitest-runs, translate-readme); script debug vilao/cli/release gom vào `scripts/debug/`.

### Performance

- **sql.js adapter:** reuse prepared statement theo SQL string (trước đây prepare/free mỗi lần gọi — ngang bằng 3 adapter native).
- **`/v1/models` + `/office/v1/models`:** `buildModelsList` bọc cache 1s (env `MODELS_LIST_CACHE_TTL_MS`, 0 = tắt) + in-flight dedupe — mỗi build trước đây fan-out 5 DB read + fetch upstream catalog.
- **`logs/` tự dọn:** request log session quá `LOG_RETENTION_DAYS` (7) bị prune mỗi giờ khi bật `ENABLE_REQUEST_LOGS`.
- **Frontend:** 4 modal click-only trên trang provider detail chuyển sang `next/dynamic` — initial chunk route `providers/[id]` giảm 72K → 60K (raw); `material-symbols` về devDependencies, bỏ khỏi `optimizePackageImports`; thêm `NEXT_DIST_DIR` để build phân tích không xung đột lock với server đang chạy.

### Changed

- **Logging chuẩn hóa:** ~170 chỗ `console.log("Error ...")` trong catch → `console.error`; log chatter `[OFFICE-SSE]` + thinking-override → `dbg()` (chỉ hiện khi dev); root có script `npm test`delegate sang suite fast.

## 0.10.5 - 2026-08-29

### Added

- **WorkBuddy hỗ trợ nhiều tài khoản:** trước đây `upsertConnection` trong `src/app/api/oauth/workbuddy/[action]/route.js` luôn cập nhật connection đầu tiên tìm thấy → đăng nhập tài khoản mới chỉ ghi đè account cũ, không bao giờ thêm được connection thứ hai. Giờ dedupe theo `providerSpecificData.workbuddyUserId` (uid = claim `sub`, kèm decode JWT trên `apiKey`/`accessToken` đã lưu): trùng uid → refresh connection đó, uid mới → tạo connection riêng (priority max+1, đổi tên thêm đuôi `· xxxx` khi trùng tên). Nút **OAuth (Web Login)** mới trên trang WorkBuddy AI (`providers/[id]/page.js`) mở flow web thật kể cả khi app desktop đang đăng nhập — `GET /device-code?mode=web` bỏ qua fast-path import app và POST poll tôn trọng mode của flow (web không bao giờ import session app). Nút **OAuth** cũ giữ nguyên hành vi import app session. Connection được đặt tên theo email/tên tài khoản (Keycloak `userinfo`: email → name → preferred_username, fallback `nickname` của token; 2 connection cũ được migrate tên + email trực tiếp trong DB); re-login chỉ tự đổi tên khi tên hiện tại vẫn là tên tự sinh — tên user tự đặt được giữ nguyên. Test: `tests/unit/oauth-workbuddy-multi-account.test.js` (9 case).

## 0.10.4 - 2026-08-29

### Added

- **Provider mới `workbuddy` (alias `wb`) — WorkBuddy AI / Tencent CodeBuddy, xếp nhóm OAuth Providers:** upstream `https://www.workbuddy.ai/v2/chat/completions` (OpenAI-compatible, 19 model: `hy4-preview` context 1M + vision + reasoning, `hy3`, `gpt-5.6-*`, `gemini-3.5-flash`, `kimi-k3`, …). Hai quirk đo thật được xử lý trong executor mới `open-sse/executors/workbuddy.js`: upstream từ chối non-stream (code 11101) nên `transformRequest` đồng bộ `body.stream` với cờ forceStream (trước đó body giữ `stream:false` của client và bị 400), và message đầu bắt buộc là system (11128) nên tự prepend system mặc định khi thiếu. Auth = `Authorization: Bearer <accessToken>` + `X-User-Id` (uid lấy từ claim `sub` của JWT, không cần field riêng). `capabilities.js` khai báo context/output thật của từng model.
- **Ba đường lấy credential (ưu tiên: token paste > token của connection > session app desktop):** (1) nút **OAuth** trên máy có app WorkBuddy đang đăng nhập import thẳng session của app — route `src/app/api/oauth/workbuddy/[action]/route.js` trả device-code **không** kèm `verification_uri` nên modal không mở tab nào và poll đầu tiên thành công ngay; (2) máy không có app đi flow web login thật của hãng (`POST /v2/plugin/auth/state?platform=workbuddy-ai` → mở `authUrl` → poll `GET /v2/plugin/auth/token?state=`, pending = code 11217); (3) API key `auto` đọc file session `%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth\workbuddy-desktop-ai.info` (app tự refresh và ghi lại), hoặc paste JWT (~11 tháng).
- **Token tự refresh không cần app desktop:** executor `refreshCredentials` gọi đúng endpoint của app (`POST /v2/plugin/auth/token/refresh` với `X-Refresh-Token` + `X-Auth-Refresh-Source: plugin`) khi gặp 401; token mới được chatCore ghi lại vào connection.
- **Test connection cho workbuddy:** `testUtils.js` probe Keycloak `userinfo` bằng session đã resolve (không tốn quota inference) cho cả connection authType oauth lẫn apikey; nút Test hết báo "Provider test not supported".
- **Hướng dẫn dùng free Hy4:** `docs/WORKBUDDY-FREE-HY4.md` — ba cách đăng nhập (import app / web login / paste JWT), cách gọi `wb/hy4-preview`, kèm quirk phía WorkBuddy: browser đã có phiên web thì trang login nhảy `/login/started` và không bàn giao state cho backend → poll web không nhận, phải dùng đường import app hoặc paste token. README thêm bullet Features trỏ tới doc này.

## 0.10.3 - 2026-08-28

### Fixed

- **Mọi request chat trả HTTP 500 (regression từ 0.10.2):** khối session-pinning trong `handleSingleModelRequest` (`src/sse/handlers/chat.js`) tham chiếu `settings` và `routedModelStr` — hai biến chỉ tồn tại trong scope của `handleChat`, không có trong hàm này (tên đúng là `chatSettings` / `modelStr`) → mọi request ném `ReferenceError: settings is not defined`, combo bắt và coi như model fail → "All models failed" 500. Endpoint `/v1/models` không đi qua đường này nên vẫn 200 — client mới báo "found Claude models but test request failed". Đã đổi về đúng biến trong scope; verify bằng test request thật qua combo (`[COMBO] Model ... succeeded`, HTTP 200).

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
