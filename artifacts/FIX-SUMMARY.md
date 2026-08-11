# Fix Summary — Kiến trúc & fail-thầm-lặng (Sóng 1)

**Ngày:** 2026-08-07 · **Reviewer→Fixer:** Code Review Expert
**Gate:** `npm run gate` → ✅ No regression (now fails=14, baseline known=15, all known). Không có pass→fail mới.
**Chạy bằng:** Node 24 (system). `better-sqlite3` chỉ chạy đúng trên Node 24.
⚠️ **LƯU Ý CHẠY GATE:** `qa-gate.mjs` gọi `npm run test:report` → `npm` lấy Node 22 (managed) mặc định → `request-details-tab :: backupDbLite` FAIL giả trên Node 22 (better-sqlite3 khác行为). Chạy gate ĐÚNG bằng Node 24: `"C:/Program Files/nodejs/node.exe" node_modules/vitest/vitest.mjs run --reporter=dot --reporter=json --outputFile=.vitest-reports/current-results.json --exclude=... (xem test:report)` rồi `verify-no-regression.mjs`. Kết quả Node 24: ✅ No regression.

---

## Đã sửa (test-safe)

### A2a — sql.js persist thành atomic
**File:** `src/lib/db/adapters/sqljsAdapter.js` (`persist()`)
Ghi ra file `.tmp` rồi `fs.renameSync` thay vì `writeFileSync` trực tiếp → `kill -9` giữa chừng không còn làm corrupt file DB.

### A2b — appShutdown graceful trước khi force-kill
**File:** `src/lib/appShutdown.js` (`killAppProcesses`)
Gửi `SIGTERM` / `taskkill /PID` (không `/F`) trước, chờ tối đa 3s cho adapter flush, mới `SIGKILL`. Tránh mất/corrupt data do shutdown của chính app.

### B1 — dashboardGuard fail-closed trong production
**File:** `src/dashboardGuard.js` (`isLocalRequest`)
Nếu thiếu `x-9r-real-ip` **và** `NODE_ENV==='production'` → từ chối (không tin Host). Dev/test giữ Host-check nên suite hiện tại **không break**. Thêm cảnh báo 1 lần (`[SECURITY] ...`).

### B2 — start:bun đi qua custom-server
**File:** `package.json` (`start:bun`)
Đổi từ `bun .next/standalone/server.js` → `bun custom-server.js` để path bun production cũng stamp `x-9r-real-ip` (trước đây bypass → local-only sụp). ⚠️ Cần smoke-test thủ công (`npm run start:bun`).

### C1 — WS relay backpressure
**File:** `custom-server.js` (handler trong `realtimeServer.handleUpgrade`)
Thêm `REALTIME_HIGH_WATER = 1<<20` + `pause()/resume()` theo `bufferedAmount` cho cả 2 chiều → peer chậm không phình memory vô hạn.

### C2 — abort upstream khi client rớt lúc resolve token
**File:** `custom-server.js` (`handleRealtimeUpgrade` + `resolveRealtimeToken`)
Thêm `AbortController` + `request.socket.once('close', () => ac.abort())` → cancel internal fetch, không tạo orphan upstream WebSocket.

### A3 — driver lock + cảnh báo đổi driver
**File:** `src/lib/db/driver.js` (`initAdapter`)
Ghi `.db-driver` marker; nếu driver thực tế đổi (đặc biệt rơi vào `sql.js` từ WAL driver) → warn rủi ro mất transaction chưa checkpoint.

---

## Sóng 2 — Kiến trúc & fail-thầm-lặng (deferred items)

**Gate (Node 24):** ✅ No regression (now fails=14, baseline known=15, all known).

### C4 — hard max-duration cap (slow-drip guard)
**File:** `open-sse/utils/streamHandler.js` (`pipeWithDisconnect`) + `open-sse/config/runtimeConfig.js`
Thêm `STREAM_MAX_DURATION_MS` (mặc định 30 phút, env-override). Timer ONE-SHOT từ lúc start, **không** re-arm theo chunk → bắt được upstream "nhỏ giọt" (gửi 1 byte mỗi vài phút) mà stall-timeout per-chunk không trị được. Clear trên mọi path terminate.

### C7 — `STREAM_FIRST_CHUNK_TIMEOUT_MS` không còn dead
**File:** `open-sse/utils/streamHandler.js` (`pipeWithDisconnect`) + `runtimeConfig.js`
Config cũ không dùng giờ được wire thành **one-shot prefill watchdog**: abort nếu upstream không gửi byte đầu tiên trong `STREAM_FIRST_CHUNK_TIMEOUT_MS` (mặc định 200s). Clear ngay khi chunk đầu tới; không re-arm. Trị được hang lúc auth/prefill.

### C3 — Perplexity/Grok abort upstream ngay khi client rớt
**File:** `open-sse/executors/perplexity-web.js`, `open-sse/executors/grok-web.js`
Thêm `AbortController` riêng cho upstream fetch (`upstreamAc`), compose với `signal` cha (parent abort → cũng abort). Thêm `cancel(reason)` trên `ReadableStream` streaming → `upstreamAc.abort()` lập tức khi downstream huỷ, thay vì chờ 500ms delayed `streamController` abort. Generator vẫn check `signal?.aborted`. Không đổi path non-streaming. Test `perplexity-web.test.js` (24 tests) vẫn xanh.

> Note: 2 executor này THỰC TẾ vẫn đi qua `handleStreamingResponse → pipeWithDisconnect` (chatCore.js:279 truyền `streamController.signal`), nên disconnect đã abort được upstream — nhưng qua độ trễ 500ms. C3 làm teardown tức thì & không phụ thuộc vào path đó.

### A1 — sql.js xử lý orphan WAL sidecar
**File:** `src/lib/db/adapters/sqljsAdapter.js` (`createSqlJsAdapter`)
sql.js là WASM in-memory, **không thể replay** `-wal`/`-shm`. Khi rơi vào adapter này, nếu có sidecar từ native driver trước đó → cảnh báo LOUD + `fs.unlinkSync` xoá sidecar, tránh: (a) mất data câm, (b) native driver sau này áp dụng WAL cũ lên file main do sql.js export → corrupt. Không revert data, chỉ làm on-disk tự nhất quán.

### C5 — cap concurrency upstream (default OFF)
**File:** `open-sse/utils/upstreamConcurrency.js` (mới) + `open-sse/handlers/chatCore.js`
Module đếm in-flight + optional hard cap. Mặc định `UPSTREAM_CONCURRENCY_LIMIT=0` (tắt) → behavior hiện tại không đổi. Nếu set >0 → reject 429 khi vượt. Acquire trước `execute`, release trong `finally`. Là soft guard (đếm lúc initiate, không đếm socket trong streaming).

### C8 — gate cứng cáp với Node version (debug false-regression)
**File:** `scripts/qa-gate.mjs`
DEBUG: gate báo "1 pass→fail: `request-details-tab :: backupDbLite`" dưới Node 22. Root cause = better-sqlite3 native binding build cho **Node 24 (ABI 137)**, Node 22 (ABI 127) load fail `ERR_DLOPEN_FAILED` (test mở backup trực tiếp bằng `better-sqlite3` ở dòng 139). Không phải bug code.
FIX: thêm guard `NODE_MAJOR < 24` → fail loud exit 2 (thông báo rõ dùng system Node 24) thay vì sinh regression giả; và ép vitest chạy bằng đúng Node đã launch script (prepend `dirname(process.execPath)` vào PATH) thay vì qua `npm` lấy Node 22 managed.
Kết quả: `qa-gate.mjs` dưới Node 24 → ✅ No regression (exit 0); dưới Node 22 → lỗi rõ ràng exit 2.

---

## Chưa sửa (defer — cần refactor lớn hơn)

- **C6:** Cursor executor (`open-sse/executors/cursor.js`) buff full response vào RAM (`Buffer.from(await response.arrayBuffer())` ở `makeFetchRequest`) rồi mới `transformProtobufToSSE`. Để stream thực sự cần viết lại streaming protobuf frame parser (khung hiện tại parse cả buffer đồng bộ) — rủi ro cao, dễ gãy logic frame tinh vi. **Để sau**, kèm plan: parse frame tăng dần từ `response.body` reader, emit SSE mỗi khi đủ 1 frame. Hiện chỉ là 🟡 biết trước, không block.

---

## Cách verify lại
```bash
# BẮT BUỘC Node 24 (system). Node 22 làm better-sqlite3 lỗi / sinh false-regression.
NODE="C:/Program Files/nodejs/node.exe"
cd tests
"$NODE" node_modules/vitest/vitest.mjs run unit/perplexity-web.test.js   # 24 passed
"$NODE" node_modules/vitest/vitest.mjs run --reporter=dot --reporter=json --outputFile=.vitest-reports/current-results.json \
  --exclude="**/node_modules/**" --exclude="**/db-benchmark.test.js" --exclude="**/db-concurrent.test.js" \
  --exclude="**/performance-observability.test.js" --exclude="**/*.live.test.js" --exclude="**/*.real.test.js"
"$NODE" __baseline__/verify-no-regression.mjs .vitest-reports/current-results.json   # ✅ No regression
```
