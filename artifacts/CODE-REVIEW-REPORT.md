# Code Review Report — Switch-Router

**Ngày:** 2026-08-07 · **Reviewer:** Code Review Expert · **Trạng thái:** chỉ review, chưa sửa code
**Phạm vi:** `custom-server.js` (đọc toàn bộ), `src/dashboardGuard.js` (toàn bộ), `src/lib/appShutdown.js`, `src/app/layout.js`, cộng khảo sát `src/` + `open-sse/` bởi agent.

---

## 📋 Tóm tắt (Summary)

**Ấn tượng chung:** Nền tảng khá vững — adapter SQLite **parameterize** query đúng cách, `custom-server.js` xử lý forwarding header rất chuẩn (chỉ trust khi peer là loopback), và có các guard chống double-upgrade sạch. Tuy nhiên lớp **auth / trust-boundary** có vài lỗ hổng thật cần vá trước bản phát hành tiếp theo, đặc biệt là fallback `Host` header và cách sinh CLI token.

**Điểm tốt (praise):**
- ✅ `custom-server.js:119-139` — strip `x-forwarded-for`/`x-real-ip` và chỉ trust khi TCP peer là loopback. Defense đúng.
- ✅ `custom-server.js:67-72` — `upgradeSettled` guard chặn double-upgrade WebSocket. Pattern sạch.
- ✅ Adapter chain (`src/lib/db/adapters/*`) — mọi query qua prepared statement `(run/get/all)` với params → **không có SQL injection** ở query path.
- ✅ `src/lib/appShutdown.js` — PID được validate `/^\d+$/` trước khi đưa vào `execSync` → không injection.
- ✅ `src/app/layout.js:36` — `dangerouslySetInnerHTML` dùng chuỗi **tĩnh** hardcoded → an toàn (không phải lỗi).

**Quan ngại chính:** (1) Host-header bypass, (2) CLI token suy ra được từ machine id bị lộ, (3) redaction secret không đủ → lộ key trong response, (4) SSRF qua `baseUrl` provider không validate, (5) thiếu timeout ở nhiều chỗ fetch.

---

## 🔴 BLOCKERS — phải sửa trước khi release

### 🔴 1. Host-header spoofing bypass cổng "local-only"
**File:** `src/dashboardGuard.js:77-80` (hàm `isLocalRequest`), ảnh hưởng `canAccessLocalDashboard`, `ALWAYS_PROTECTED` (153-157), `canAccessPublicLlmApi` (116-120).

**Why:** Khi header `x-9r-real-ip` / `x-9r-via-proxy` **không có** (chính là trường hợp `next dev` và mọi `next start` không qua `custom-server.js`), hàm fallback tin vào header `Host` do client kiểm soát:
```js
} else if (!isLoopbackHostname(request.headers.get("host"))) {
  return false;
}
```
Một request (vd. `curl` không gửi `Origin`) với `Host: 127.0.0.1` sẽ thoả mãn `isLocalRequest() === true`. Từ đó mở khoá toàn bộ `ALWAYS_PROTECTED` (`/api/shutdown`, `/api/settings/database` — export/import DB đầy đủ, `/api/app/shutdown`) và cho truy cập LLM API **không cần key** (vì `canAccessPublicLlmApi` trả true với local). `custom-server.js` che được ở prod, nhưng **dev và mọi deploy không qua custom-server đều bị hở**.

**Suggestion:**
- Không bao giờ lấy `Host` làm căn cứ authorization. Chỉ `x-9r-real-ip` (do `custom-server.js` đóng dấu từ TCP socket) mới có thẩm quyền.
- Ở bare server (không có `x-9r-real-ip`), mặc định **từ chối** local-only routes thay vì fallback tin `Host`. Nếu cần dev tiện lợi, dùng biến env tường minh (`ALLOW_LOCAL_DASHBOARD=true`) thay vì tin header.

---

### 🔴 2. CLI token suy ra được từ machine id bị API trả về
**File:** `src/dashboardGuard.js:5-18` (`CLI_TOKEN_SALT="9r-cli-auth"`; `getCliToken = getConsistentMachineId(CLI_TOKEN_SALT)`) + `src/app/api/keys/route.js:36` (trả `machineId` cho client).

**Why:** CLI token là khoá master mở mọi route `ALWAYS_PROTECTED`/`LOCAL_ONLY_PATHS`. Nó là hàm **xác định** của machine id, và machine id đó lại được `/api/keys` trả về client. Trên máy đa người dùng, bất kỳ process local nào (hoặc ai đọc được response API) đều tái tạo được CLI token → gọi shutdown / export-import DB / auto-import tự do. Tức là "local-only" sụp đổ hoàn toàn ở local.

**Suggestion:**
- Sinh CLI secret **ngẫu nhiên, lưu persisted** (như `SWITCH_ROUTER_INTERNAL_SECRET` trong `custom-server.js`), không phái sinh từ thông tin bị lộ.
- Nếu vẫn muốn deterministic cho CLI local, đừng trả `machineId` ra ngoài qua `/api/keys`.

---

### 🔴 3. Redaction secret không đủ → có thể lộ provider secret trong API response
**File:** `src/core/credentials/credentialProjection.js:10` (regex) và `58-66` (`redactProviderConnection`).

**Why:** Pattern chỉ khớp `api_key, access_token, refresh_token, id_token, copilot_token, client_secret, cookie, password, authorization, session_token`. **Không** khớp `secret`, `privateKey`/`private_key`, `oauthToken`, `bearer`, `passphrase`, `token`. Redaction cũng chỉ quét bề mặt `providerSpecificData` (không đệ quy). Vì provider data là do user định nghĩa, các field như `privateKey`/`secret`/`oauthToken` sẽ **sống sót** qua `redactProviderConnection` và có thể bị serialize trả về ở các endpoint dashboard/API.

**Suggestion:**
- Chuyển sang **allowlist** các field được phép trả về (an toàn hơn denylist), hoặc mở rộng denylist + redact đệ quy toàn bộ object.
- Viết test: chèn connection có `privateKey` rồi assert response **không** chứa giá trị đó.

---

## 🟡 SUGGESTIONS — nên sửa

### 🟡 4. SSRF — fetch tới `baseUrl` provider do user kiểm soát, không validate
**File:** `src/app/api/providers/validate/route.js` (108, 126, 156-161, 189-194, 244, 318-320, 328, 370, 512); `open-sse/config/providers.js:7-10`; runtime: `open-sse/handlers/ttsProviders/genericFormats.js`, `open-sse/handlers/sttCore.js`.

**Why:** `baseUrl`/`azureEndpoint`/`providerSpecificData.baseUrl` (user input) được ghép thẳng vào `fetch()` URL, không chặn scheme không phải http(s), không chặn private/link-local range (vd. `169.254.169.254` metadata). Bất kỳ caller nào qua middleware (localhost hoặc CLI token) đều có thể trỏ server đi gọi internal service. **Chuỗi leo thang:** kết hợp với 🔴#2 (CLI token lấy được từ machine id), SSRF này trở nên reachable bởi process local bất kỳ.

**Suggestion:**
- Validate mọi `baseUrl` user-supplied: chỉ `http(s)`, reject IP private/loopback/link-local (dùng thư viện như `ipaddr.js` hoặc danh sách dải bị cấm).
- Tập trung logic validate vào một hàm dùng chung.

---

### 🟡 5. Thiếu timeout trên nhiều nhánh fetch (provider validate & runtime TTS/STT)
**File:** `src/app/api/providers/validate/route.js:109,126,164` (một số nhánh OpenAI/embedding/Anthropic **không** có `AbortSignal.timeout`); tương tự `open-sse/handlers/ttsProviders/*.js`, `sttCore.js`.

**Why:** Endpoint user-controlled chậm/hang sẽ giữ request (và 1 socket) mở vô hạn → exhaustion. Kết hợp #4, một `baseUrl` crafted có thể pin worker.

**Suggestion:** Áp dụng timeout đồng nhất (`AbortSignal.timeout(5000)`) cho **mọi** outbound fetch.

---

### 🟡 6. Token realtime truyền qua query string + thiếu Origin check
**File:** `custom-server.js:46-47` (`api_key`/`token` trong URL) và `62-64` (không validate `Origin` ở WS upgrade).

**Why:** Token trong URL bị log ở proxy/access log, browser history, referer. WS handshake từ browser không set được arbitrary header nên đây là fallback phổ biến — nhưng vẫn là rủi ro. Thiếu Origin allowlist khiến một trang web ác ý có thể mở WS nếu token nằm trên URL.

**Suggestion:**
- Ưu tiên `Authorization: Bearer` (đã có ở 44) và chỉ coi query token là fallback cuối; đảm bảo token URL không bị log và là single-use/short-lived.
- Thêm allowlist `Origin` cho route `/v1/realtime`.

---

### 🟡 7. Không có timeout cho fetch lấy internal credential
**File:** `custom-server.js:49-56`.

**Why:** `fetch('/api/internal/stepfun-credentials')` không có `signal`. Nếu endpoint này hang, promise upgrade treo vô hạn (upstream chỉ tạo sau khi fetch xong) → connection leak.

**Suggestion:** Thêm `signal: AbortSignal.timeout(5000)`.

---

### 🟡 8. Single global mutex serializes mọi chọn credential provider
**File:** `src/sse/services/auth.js:10-29` (`selectionMutex` là 1 Promise chain toàn process).

**Why:** Mọi lần `getProviderCredentials` chiếm 1 mutex chung → bước chậm trong critical section (DB read, resolve proxy config) block **toàn bộ** routing của mọi provider. Nút thắng tắc dưới concurrency.

**Suggestion:** Dùng mutex **per-provider** (hoặc per-provider-strategy) thay vì 1 global.

---

### 🟡 9. Ba bản sao `extractApiKey` behaviour khác nhau
**File:** `src/dashboardGuard.js:100-108` vs `src/sse/services/auth.js:276-290` vs `v1beta route` `extractGeminiClientApiKey`.

**Why:** Guard đọc cả `x-goog-api-key` và `key` query; `auth.js` chỉ `Authorization`/`x-api-key`. Sửa ở chỗ này không áp dụng chỗ kia → semantic auth không nhất quán.

**Suggestion:** Gom về 1 helper dùng chung, truyền option cho phép trường nào.

---

## 💭 NITS — nice to have

- **💭 Dead/misleading CRC:** `src/shared/utils/apiKey.js:78-87` `verifyApiKeyCrc` luôn trả `true` (no-op); auth thực tế chỉ là DB-membership (`apiKeysRepo.js:70-75`). Gây hiểu lầm là key có integrity protection. → Hoặc verify thật, hoặc xoá.
- **💭 SQL interpolation trong Cursor auto-import:** `src/app/api/oauth/cursor/auto-import/route.js:116,131` `` `SELECT value FROM itemTable WHERE key='${key}'` ``. `key` hiện là constant → chưa khai thác được, nhưng là pattern nguy hiểm nếu sau này dynamic. → Dùng better-sqlite3 bind.
- **💭 Unsafe `JSON.parse`** trên config/stored input ở `src/app/api/cli-tools/opencode-settings/route.js` và `openclaw-settings/route.js` → wrap try/catch trả 400 thay vì 500 rò đường dẫn.
- **💭 `models/custom` POST** (`src/app/api/models/custom/route.js:20-24`) không validate format/length `id`, không dedupe rõ ràng trước `addCustomModel`.
- **💭 Global mutable caches** (`src/lib/db/repos/usageRepo.js` module-level `global._usage*`) chia sẻ cross-request → staleness/race tiềm ẩn dưới hot-reload. → scope per-request hoặc version theo adapter instance.
- **💭 WAL checkpoint `setInterval`** (`betterSqliteAdapter.js:24-27` và tương đương) có thể giữ event loop sống nếu adapter tạo ad-hoc trong test/import mà không `close()`.
- **💭 Dynamic DDL interpolation** (`src/lib/db/migrate.js:97` `` `ALTER TABLE ${tableName} ADD COLUMN ${colName} ${safeDef}` ``) an toàn hôm nay (constraint từ code) nhưng fragide nếu schema value sau này bị external influence.
- **💭 Ping/pong thiếu** ở WebSocket proxy (`custom-server.js:88-103`) → connection có thể leak nếu client im lặng; thêm heartbeat + idle timeout.
- **💭 `taskkill` dùng `shell:true`** (`appShutdown.js:61-66`) dư thừa dù pid đã validate; có thể bỏ `shell`.

---

## ✅ Đã xác minh AN TOÀN (không phải lỗi)

| Vị trí | Kết luận |
|--------|----------|
| `src/app/layout.js:36` dangerouslySetInnerHTML | Chuỗi tĩnh, không có input người dùng → OK |
| `src/lib/appShutdown.js` PID → `kill -9 ${pid}` | PID validate `/^\d+$/` → OK |
| SQLite adapter chain query path | Parameterized → không SQL injection |
| `custom-server.js:125-137` x-forwarded-for | Strip + chỉ trust loopback peer → OK |
| `src/lib/mcp/stdioSseBridge.js:117` spawn | Chỉ từ `LOCAL_STDIO_PLUGINS` preset → OK |
| `src/lib/pxpipe/install.js` spawn | Arg constant `pxpipe-proxy@latest` → OK |

---

## 🎯 Ưu tiên xử lý (gợi ý)

1. 🔴 #1 Host-header bypass — vá ngay, đặc biệt nếu có deploy không qua `custom-server.js`.
2. 🔴 #2 CLI token derivation — đổi sang persisted random secret.
3. 🔴 #3 Redaction — chuyển allowlist + test.
4. 🟡 #4 + #5 SSRF + timeout — gom thành 1 hàm validate `baseUrl` + áp dụng timeout uniform.
5. 🟡 #8 Mutex per-provider — nếu có vấn đề throughput.

*Chưa sửa code. Báo cáo này để team thảo luận và làm căn cứ cho PR fix.*
