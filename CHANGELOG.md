# Switch-Router Changelog

This file tracks changes for the local personal build only.

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
