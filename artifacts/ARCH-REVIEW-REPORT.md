# Architecture & Silent-Failure Review — Switch-Router

**Ngày:** 2026-08-07 · **Reviewer:** Code Review Expert · **Trạng thái:** chỉ review, chưa sửa code
**Lăng kính:** Kiến trúc & fail-thầm-lặng (không phải checklist an ninh chung). Tập trung vào những rủi ro mà OWASP checklist không bắt được — do thiết kế, do precondition deploy, và do fail *im lặng*.

---

## 📋 Tóm tắt

Điểm tốt (praise) trước:
- ✅ **Main chat SSE path có backpressure đúng** — `pipeThrough` + `ReadableStream({pull})` (`open-sse/utils/streamHandler.js`), ép backpressure từ socket lên tới upstream `fetch`. Đây là cách làm chuẩn, hiếm project làm được.
- ✅ Adapter query **parameterized** → không SQL injection.
- ✅ `custom-server.js` xử lý `x-forwarded-for` chuẩn (chỉ trust khi peer loopback).

Nhưng dưới lớp đó có **3 quả bom kiến trúc** không ai nhìn thấy bằng mắt thường:

1. **Mất/corrupt data thầm lặng qua adapter chain + đường shutdown của chính app.**
2. **Toàn bộ mô hình "local-only" treo vào 1 file, và 2/4 đường deploy tài liệu hoá sẵn vô hiệu hoá nó im lặng.**
3. **Relay SSE/WS rò rỉ upstream + không backpressure ở vài nhánh.**

---

## 🔴 A. PERSISTENCE — bom mất data / corrupt thầm lặng

### 🔴 A1. Đổi driver sang `sql.js` mất transaction chưa checkpoint (WAL)
**File:** `src/lib/db/driver.js:60-63`, `src/lib/db/schema.js:9` (`PRAGMA journal_mode = WAL`), `src/lib/db/adapters/sqljsAdapter.js:15` (`fs.readFileSync(filePath)`).

**Why:** `better-sqlite3`/`node:sqlite`/`bun` chạy WAL → committed transaction có thể nằm trong file `-wal`/`-shm` chưa checkpoint. `sql.js` khi mở chỉ đọc **file main** (`fs.readFileSync(filePath)`), **bỏ qua `-wal`/`-shm`**. Vậy mỗi lần restart mà rơi vào `sql.js` (vd. `better-sqlite3` load fail, hoặc do optionalDependency chưa cài build tool) → **mất sạch transaction chưa checkpoint**. Mà `better-sqlite3` nằm ở `optionalDependencies` (`package.json:54-57`) — tức dự án *mong đợi* fallback này xảy ra trên máy thiếu build tool.

**Suggestion:**
- Khi chọn `sql.js`, trước khi mở hãy `PRAGMA wal_checkpoint(TRUNCATE)` bằng driver cũ nếu có, hoặc đọc cả `-wal`/-shm vào sql.js.
- Ghi log **cảnh báo nổi bật** (không chỉ `[DB] Driver: sql.js`) khi rơi vào fallback: "⚠️ Running on in-memory-backed sql.js — data loss risk if process killed".

### 🔴 A2. `kill -9` từ chính app có thể corrupt file DB của `sql.js`
**File:** `src/lib/db/adapters/sqljsAdapter.js:24-38` (debounce 100ms, `writeFileSync` không nguyên tử), `:109-112` (`beforeExit`/`SIGINT`/`SIGTERM` flush); `src/lib/appShutdown.js:61,68` (`kill -9` / `taskkill /F`).

**Why:** `sql.js` chỉ flush qua `setTimeout` 100ms và các handler `SIGINT`/`SIGTERM`/`beforeExit`. Nhưng `/api/shutdown` & `/api/app/shutdown` (route `ALWAYS_PROTECTED`) gọi `killAppProcesses()` dùng **`kill -9`** — mà `SIGKILL` không kích hoạt bất kỳ handler nào. Hậu quả:
- Mọi write trong 100ms cuối trước khi shutdown → **mất**.
- `writeFileSync` không nguyên tử → nếu bị kill giữa lúc ghi, file DB **bị cắt ngang / corrupt** (sql.js không có WAL sidecar để recover).
Tức là: tính năng tắt app của chính dự án có thể làm hỏng DB khi đang chạy trên adapter fallback.

**Suggestion:**
- Không `kill -9` ngay. Gửi `SIGTERM`, chờ adapter `close()` flush (có timeout), mới `SIGKILL` phương án cuối.
- Đổi `writeFileSync` thành ghi qua temp file + `rename` (atomic) để tránh corrupt nửa chừng.

### 🟡 A3. Không có "driver lock" — restart đổi driver ngầm
**File:** `src/lib/db/driver.js:55-73`.

**Why:** Driver được chọn lại mỗi lần process khởi động theo môi trường. Một ngày chạy `better-sqlite3` (có WAL), hôm sau do thiếu native binding lại chạy `sql.js` → kích hoạt A1. Không có file marker ghi "lần trước dùng driver X, đừng đổi" và không cảnh báo khi đổi.

**Suggestion:** Ghi `DATA_DIR/.db-driver` sau khi init; lúc khởi động nếu driver thực tế ≠ driver đã ghi → cảnh báo + (nếu an toàn) chạy checkpoint trước khi switch.

---

## 🔴 B. SECURITY MODEL — treo vào 1 điểm, 2/4 đường deploy vô hiệu hoá im lặng

### 🔴 B1. Toàn bộ "local-only" chỉ靠 1 header do `custom-server.js` đóng dấu
**File:** `custom-server.js:133-137` (set `x-9r-real-ip`/`x-9r-via-proxy`); consumers `src/dashboardGuard.js:72-74`, `src/lib/auth/loginLimiter.js:50`.

**Why:** Grep toàn repo xác nhận **chỉ có `custom-server.js`** set 2 header này. Nghĩa là:
- `dashboardGuard` (cổng local-only) **và** `loginLimiter` (rate-limit login) đều tin tưởng hoàn toàn vào header do custom-server sinh từ TCP socket.
- Nếu custom-server không nằm trong request path → header vắng mặt → dashboardGuard fallback tin `Host` (bypass được, đã nêu ở báo cáo trước), còn loginLimiter lấy `null` làm key → mọi người chia chung 1 bucket rate-limit (vô hiệu hoá giới hạn login).

### 🔴 B2. `dev` và `start:bun` bypass custom-server → local-only sụp, không cảnh báo
**File:** `package.json:10` (`dev`: `next dev …`), `:17` (`start:bun`: `bun .next/standalone/server.js`); `:14` (`start`: `node custom-server.js` — duy nhất đúng).

**Why:** Trong 4 script deploy tài liệu hoá:
- `start` → qua custom-server ✅
- `dev` → `next dev` **không** qua custom-server ❌ (mà dev là mode dev dùng suốt ngày)
- `start:bun` → `bun .next/standalone/server.js` **không** qua custom-server ❌
- `dev:bun` → `bun next dev` ❌

Tức là dev mode và mọi ai chạy bản bun đều **tự động mất lớp local-only** mà không hề có log báo. Đây là fragility kiến trúc: lời hứa "personal/local-only" là một **precondition deploy không ai enforce**.

**Suggestion:**
- Tách hàm kiểm tra "local" thành module dùng chung, và **hard-fail rõ ràng** nếu chạy ở mode cần bảo vệ mà thiếu `x-9r-real-ip` (thay vì fallback tin `Host`).
- Với `dev`, ép qua 1 middleware tương đương custom-server (hoặc in cảnh báo lớn "DEV MODE: local-only NOT enforced").
- Đưa custom-server vào **bắt buộc** cho mọi `start`/`start:bun` (wrap standalone server thay vì chạy trực tiếp).

---

## 🔴 C. STREAMING RELAY — rò rỉ upstream & không backpressure

### 🔴 C1. WebSocket relay forward mù, không backpressure (cả 2 chiều)
**File:** `custom-server.js:88-90` (`client.on('message') → upstream.send`), `:95-97` (`upstream.on('message') → client.send`).

**Why:** Không `pause()`/`resume()`, không check `bufferedAmount`. `ws` đệm byte vào queue nội bộ khi socket peer đầy → client chậm làm `client.send` phình memory vô hạn, upstream chậm làm `upstream.send` phình vô hạn. Đường SSE HTTP thì dùng `pipeThrough` backpressure đúng, nhưng WS relay thì không.

**Suggestion:** Thêm `ws` `pause()/resume()` dựa trên `bufferedAmount` (hoặc dùng `readyState` + `bufferedAmountLow`), và cap kích thước message.

### 🔴 C2. Client disconnect trong lúc resolve token → orphan upstream WebSocket
**File:** `custom-server.js:62-114` — listener `client.on('close'/'error')` chỉ đăng ký **bên trong** `realtimeServer.handleUpgrade(...,(client)=>{…})` (`:87-104`).

**Why:** Nếu raw socket client đóng trong khi `resolveRealtimeToken` (internal `fetch`, dòng 49 — **không timeout/abort**) đang chạy, hoặc trước khi `handleUpgrade` xong → **chưa có listener nào**. Sau đó `upstream` được tạo, `once('open')` gọi `handleUpgrade` trên socket đã chết, để lại `upstream` mở vĩnh viễn, stream tới không ai.

**Suggestion:** Đăng ký `req.socket.on('close', …)` ngay đầu `handleRealtimeUpgrade` để abort fetch + close upstream; thêm `AbortController` timeout cho internal fetch (xem C4).

### 🔴 C3. Perplexity / Grok executor: client disconnect không abort upstream
**File:** `open-sse/executors/perplexity-web.js:294-355` (loop 307, không `cancel`), `open-sse/executors/grok-web.js:135-188` (loop 146).

**Why:** Hai executor này build `new ReadableStream({ async start() { for await … } })` **không `pull`, không `cancel`**, và `signal` chỉ truyền vào `fetch` chứ không nối với disconnect. Khi client rớt, Next cancel output stream → loop `controller.enqueue` ném lỗi → nhưng upstream `fetch` **không bao giờ bị abort** → tiếp tục stream tới completion rồi bị bỏ rơi (orphaned). Đường chat chính tránh được nhờ `createDisconnectAwareStream.cancel()` → `reader.cancel()`, 2 executor này lách hẳn cơ chế đó.

**Suggestion:** Chuyển 2 executor này qua `pipeWithDisconnect` (dùng chung `createDisconnectAwareStream`) thay vì tự viết loop, hoặc ít nhất nối `signal` với `streamController.signal`/`handleDisconnect`.

### 🟡 C4. Stall timeout bị reset mỗi chunk → upstream "nhỏ giọt" treo vô hạn
**File:** `open-sse/utils/streamHandler.js:194-256` (`armStall()` gọi lúc bắt đầu VÀ mỗi chunk, `:241`).

**Why:** `STREAM_STALL_TIMEOUT_MS` (360s) được **re-arm trên mỗi byte**. Upstream nhỏ giọt keep-alive (`: ping`) hoặc sparse bytes sẽ không bao giờ trip → connection mở vô hạn. Không có cap tổng thời gian end-to-end riêng.

**Suggestion:** Tách hai timer: (a) idle-stall (reset mỗi chunk, đã có), (b) hard max-duration cap (không reset).

### 🟡 C5. Không cap concurrent upstream connection
**File:** `open-sse/executors/base.js:143` (fetch mỗi request); chỉ `MEMORY_CONFIG.proxyDispatchersMaxSize:20` (`open-sse/config/runtimeConfig.js:31`) cap *proxy dispatcher*, không cap stream.

**Why:** Mỗi request streaming mở 1 `fetch` upstream mới; undici global dispatcher mặc định `maxConnections` unlimited. Flood request client-chậm → mở unbounded upstream socket (FD exhaustion / ép upstream rate-limit).

**Suggestion:** Thêm connection-pool / concurrency limiter (hoặc set `dispatcher` với `maxConnections`).

### 💭 C6. Cursor executor buff full response vào RAM
**File:** `open-sse/executors/cursor.js:193` (`Buffer.from(await response.arrayBuffer())`), `:236-242` (`Buffer.concat(chunks)`).

**Why:** "Streaming" Cursor thực chất đọc toàn bộ body vào RAM rồi replay → TTFB trễ, memory không bound với response lớn. Do đặc thù protobuf, nhưng vẫn là rủi ro memory/backpressure.

### 💭 C7. `STREAM_FIRST_CHUNK_TIMEOUT_MS` là dead config
**File:** `open-sse/config/runtimeConfig.js:56` — định nghĩa nhưng không referenced (grep chỉ thấy định nghĩa).

**Why:** `armStall()` arm lúc pipe start nên effective first-token timeout = 360s stall, không phải 200s như constant gợi ý. Gây hiểu lầm.

---

## 🎯 Sửa theo thứ tự (gợi ý)

1. **B2/B1** — ép custom-server bắt buộc + bỏ fallback `Host` (security model là precondition không được enforce → dễ bị quên nhất).
2. **A2** — thay `kill -9` bằng SIGTERM+wait+SIGKILL, ghi atomic cho sql.js (bom corrupt data do chính app gây ra).
3. **A1/A3** — checkpoint trước khi fallback sql.js + driver lock + cảnh báo nổi bật.
4. **C1/C2/C3** — backpressure WS + abort upstream khi disconnect (rò rỉ resource là thứ lộ ra dưới tải).
5. **C4/C5** — hard max-duration + connection cap.

*Chưa sửa code. Báo cáo này là bản deep-dive kiến trúc, bổ sung (không thay thế) `CODE-REVIEW-REPORT.md`.*
