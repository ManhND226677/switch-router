# Đánh giá chi tiết dự án Switch-Router

**Đánh giá:** UI/UX + Kiến trúc
**Ngày:** 2026-08-06
**Đối tượng:** `switch-router-app` v0.3.0 — local-first AI routing gateway + Next.js dashboard
**Trạng thái:** Đánh giá gốc + đã xử lý **P0 → P3** (2026-08-06). Chi tiết từng hạng mục xem bảng §3.3.

---

## 1. Tổng quan

Switch-Router là một **cổng định tuyến AI cục bộ (local-first), single-user**, đóng gói một dashboard Next.js. Nó phơi một endpoint duy nhất tương thích OpenAI (`/v1/*`) và định tuyến sang nhiều provider/model/account/combo, kèm theo translation định dạng, fallback combo/account, quản lý OAuth/API-key, token refresh, và lưu trữ cục bộ (SQLite).

Đây là một sản phẩm **rất đầy đủ tính năng** (feature-rich) chứ không phải prototype: 18 mục trong sidebar dashboard, 27 route page, hàng trăm API endpoint, và một engine dịch định dạng provider độc lập (`open-sse/`).

## 2. Quy mô & công nghệ

| Hạng mục | Giá trị |
|---|---|
| Framework | Next.js 16 (`app/` router) + React 19.2 |
| Ngôn ngữ | JavaScript thuần (ESM), **không TypeScript** |
| Styling | Tailwind CSS v4 (`@theme inline` + CSS variables) |
| State | Zustand (7 store: theme, settings, user, provider, headerSearch, notification) |
| DB | SQLite adapter chain: `bun:sqlite` → `better-sqlite3` → `node:sqlite` → `sql.js` |
| Icons | Material Symbols (ligature) |
| Charts/Flow | Recharts, `@xyflow/react` (React Flow) |
| LOC ước tính | `src/` ~387 file JS, `open-sse/` ~315 file JS, `tests/` ~385 JS + 189 TS |
| Tests | Vitest, baseline + `known-fails.txt` (~938 pass / ~64 fail kỳ vọng) |

## 3. Đánh giá UI/UX (trọng tâm)

### 3.1 Hệ thống thiết kế & token — **9/10** ✅ Rất tốt

`src/app/globals.css` là một hệ thống token chín muồi:
- Bảng màu brand (brand-50…900) xuyên suốt light/dark,中性 warm base (`#FDFAF6` / `#1a1a1a`).
- Biến semantic rõ ràng: `--color-surface`, `--color-border`, `--color-text-muted`, status (`danger/success/warning/info`).
- Radius (`--radius-brand`, `--radius-brand-lg`) và 5 cấp shadow (soft/warm/elevated/elev/focus) được định nghĩa nhất quán.
- Ánh xạ đúng cách vào Tailwind v4 qua `@theme inline`, nên component dùng được `bg-brand-500`, `text-text-muted`, `border-border`…
- Hỗ trợ dark mode chuẩn (`@custom-variant dark`), `color-scheme`, scrollbar tuỳ biến, selection tinted brand.

**Kết luận:** Đây là nền tảng design-system vững chắc, hiếm thấy ở dự án cá nhân quy mô này.

### 3.2 Bố cục & Kiến trúc thông tin — **8/10**

- `DashboardLayout` (`src/shared/components/layouts/DashboardLayout.js`): shell chắc chắn — sidebar desktop ẩn dưới `lg`, drawer mobile có overlay, toast host góc phải, grid background tinh tế.
- `Sidebar`: điều hướng rõ ràng, nhóm "System", accordion Media Providers, mục Translator được gate bằng setting (`/api/settings`). Active state dùng `bg-primary/10 text-primary` + icon `fill-1`.
- **Vấn đề IA:** 18 mục dashboard là **quá dày** cho người mới. Các mục debug (Console Log, Translator) nằm ngay trong nav System thay vì ẩn sau chế độ dev. Cần cân nhắc gom nhóm (Provider/Model management, Observability, System) để giảm nhận thức tải.

### 3.3 Responsive & Mobile — **7/10**

- Grid responsive tốt: `grid-cols-1 → sm:2 → lg:3 → xl:4` (vd. `providers/page.js` dòng 377, 425, 466, 527).
- Mobile drawer hoạt động; tiêu đề/action stack dọc trên màn nhỏ.
- **Caveat:** Đây là tool localhost desktop, nên mobile là thứ yếu — thiết kế desktop-first là hợp lý, nhưng tablet (`md`) chưa được tối ưu riêng (sidebar chỉ hiện ở `lg`).

### 3.4 Chất lượng component & tính nhất quán — **7/10**

Tích cực:
- `Button` có hệ variant (`primary/secondary/outline/ghost/danger/success`) + size (`sm/md/lg`), loading state, icon L/R — dùng lại tốt (`src/shared/components/Button.js`).
- `Card`, `Badge`, `Modal`, `Drawer`, `Toggle`, `Select`, `SegmentedControl` đóng gói sẵn.
- Skeleton loading (`CardSkeleton`), empty state, search tích hợp qua `headerSearchStore`.
- A11y cơ bản: `aria-label` trên các nút icon, `title` tooltip.

**Gaps (cụ thể, có thể sửa):**
1. **Landing page không dùng token hệ thống** — xem mục 3.7.
2. **Nút "Test All" tự viết tay** (`providers/page.js` dòng 405–422, 447–464, 508–525) dùng raw `className` + logic điều kiện thay vì component `Button`. Gây lệch variant/thiếu consistency.
3. **Dead code:** `dotColors` / `dotLabels` khai báo ở `providers/page.js` dòng 626/632 và 745/751 nhưng **không bao giờ được dùng** (ProviderCard & ApiKeyProviderCard).
4. Một số chỗ dùng `!bg-white !text-black` hardcode (`providers/page.js` dòng 364) phá vỡ theme dark.

### 3.5 Đa ngôn ngữ (i18n) — **5/10** ⚠️ Yếu

- `src/i18n/config.js` khai báo `LOCALES = ["en","vi"]`, default `en`.
- **Thực tế:** chỉ có **`public/i18n/literals/vi.json`** tồn tại. Không có `en.json`. Nghĩa là chuỗi tiếng Anh được **hardcode inline** trong component, chỉ tiếng Việt được externalize.
- Hệ quả: muốn thêm ngôn ngữ thứ 3 phải externalize toàn bộ chuỗi English. Đây là i18n **bán phần**, không phải framework đầy đủ. Với sản phẩm 2 ngôn ngữ thì chấp nhận được, nhưng là technical debt rõ ràng.

### 3.6 Trạng thái tải / rỗng / lỗi — **8/10**

- Loading: `CardSkeleton` khi fetch (`providers/page.js` dòng 316–323).
- Empty: bordered dashed state với icon (`search_off`) khi không có kết quả.
- Error: modal kết quả test chi tiết (latency, diagnosis type, pass/fail), toast notification có 4 loại.

### 3.7 Landing page / Marketing — **6/10** ⚠️ Brand mismatch

`src/app/landing/page.js` là một trang marketing bắt mắt (hero, flow animation, orbs, sections) **nhưng có vấn đề nhất quán thương hiệu nghiêm trọng**:
- Dùng **hardcode `#f97815`** (cam) thay vì brand token `#E56A4A` — **45 tham chiếu** đến các mã màu cứng (`#f97815`, `#181411`, `#e0650a`) trong landing.
- Dùng `bg-linear-to-t` (syntax Tailwind v4) và `<style jsx global>` tự định nghĩa keyframe `blob/float/dash` — trùng lặp với animation đã có trong `globals.css`.
- CTA button `#f97815` không khớp với `btn-cta` / `bg-brand-500` của app.

=> Dashboard nói "brand cam `#E56A4A`", Landing nói "cam `#f97815`". Người dùng thấy 2 thương hiệu khác nhau.

## 4. Chất lượng code & kiến trúc

| Tiêu chí | Đánh giá |
|---|---|
| Tách biệt module | ✅ Tốt: `src/app` (route), `src/sse` (glue), `open-sse` (engine độc lập), `src/lib` (db/cred/usage) |
| Tài liệu | ✅ Rất tốt: `docs/ARCHITECTURE.md`, `SWITCH-ROUTER.md`, `open-sse/AGENTS.md`, `CLAUDE.md` |
| TODO/FIXME | ✅ **0** — sạch, không để lại marker |
| `console.log` | ⚠️ **245 lần** trong `src/` — noise debug, nên gate sau `process.env.NODE_ENV` hoặc logger |
| Dead code | ⚠️ `dotColors/dotLabels` (providers), một số block comment code cũ (vd. dòng 551–570 Web Cookie) |
| TypeScript | ⚠️ Không có — mất type-safety ở dự án quy mô này (đổi lại: tốc độ dev nhanh, phù hợp tool cá nhân) |
| Test discipline | ✅ Baseline + `known-fails.txt` + `verify-no-regression.mjs` — chín muồi |
| Git working tree | ⚠️ Đang **dirty** (CHANGELOG, CLAUDE.md, docs, `open-sse/config/kiroConstants.js` bị xoá) — có thay đổi chưa commit |

## 5. Bảo mật & đúng đắn

- `custom-server.js` xử lý IP từ TCP socket, strip `X-Forwarded-For` attacker-controlled — đúng cho local gateway.
- Secrets nhạy cảm: `JWT_SECRET`, `API_KEY_SECRET`, `MACHINE_ID_SALT` (theo `CLAUDE.md`).
- API-key enforcement **optional** cho loopback — hợp lý nhưng nên cảnh báo rõ khi tắt.
- SQLite fallback chain thiết kế fail-safe tốt (native → pure-JS).

## 6. Tóm tắt Điểm mạnh / Điểm yếu

**Điểm mạnh**
- Design-system token + dark mode xuất sắc, nhất quán (trong app).
- Tài liệu kiến trúc & test baseline chuyên nghiệp.
- Component library đóng gói tốt (Button/Card/Modal/…), a11y cơ bản có.
- Không TODO/FIXME, phân tách module rõ ràng.

**Điểm yếu**
1. 🔴 Landing page lệch brand color vs dashboard (`#f97815` vs `#E56A4A`).
2. 🟠 i18n bán phần (chỉ VI externalize, EN inline).
3. 🟠 245 `console.log` chưa được gated.
4. 🟠 Dead code & nút tự viết tay thay vì component chung.
5. 🟡 IA dashboard quá dày (18 mục), thiếu onboarding cho mới.
6. 🟡 Không TypeScript; git tree đang dirty.

## 7. Khuyến nghị ưu tiên (chưa sửa code)

| Ưu tiên | Hành động | Tác động |
|---|---|---|
| **P0** ✅ **Đã xử lý** (2026-08-06) | Thống nhất brand color: landing page đã chuyển sang token `--color-brand-*` (`bg-brand-500`/`text-brand-500`/…) và `var(--color-brand-500)` cho inline style; dark neutral căn chỉnh theo dashboard (`#1a1a1a`/`#262626`/`#333333`); glow `rgba(229,106,74,…)`. 9 file trong `src/app/landing`. | Nhất quán thương hiệu app↔marketing |
| **P1** ✅ **Đã xử lý** (2026-08-06) | **i18n VI hoàn thiện cao:** trích xuất tự động mọi chuỗi UI hiển thị (`src/app`, `src/shared`, `src/lib`, `src/core`, `src/models`), diff với `vi.json`, dịch và bổ sung **+121 entry** (201 → 322). Đã loại bỏ nhiễu (code fragment, brand name, example value, API version). EN là source/key nên mặc định luôn đầy đủ. | Phủ tiếng Việt rộng hơn, dễ bảo trì |
| **P1** ✅ **Đã xử lý** (2026-08-06) | **Gated `console.log` ở production:** thêm `ClientConsoleGate` (client-only `useEffect`, không chạy lúc SSR) tắt `log`/`debug`/`info` khi `NODE_ENV==='production'`, giữ `error`/`warn`. Không ảnh hưởng `consoleLogBuffer` server (Console Log dashboard vẫn hoạt động). Có escape hatch `window.__SR_KEEP_LOGS`. | Sạch log production, không mất tính năng |
| **P2** ✅ **Đã xử lý** (2026-08-06) | Thay 3 nút "Test All" tay (OAuth/Free/API Key) bằng shared `<Button>` (variant outline, loading state); xoá `dotColors`/`dotLabels` dead code trong `ProviderCard` & `ApiKeyProviderCard`. | Consistency + giảm dead code |
| **P2** ✅ **Đã xử lý** (2026-08-06) | **Restructure sidebar IA:** gom thành 3 nhóm rõ `Providers & Models` / `Observability` / `System` (thêm `NavLink`/`NavSection` helper). Debug items (Console Log, Translator) ẩn sau flag `enableDebug` (`/api/settings`, mặc định hiển thị trừ khi `ENABLE_DEBUG=false`); Translator giữ cờ `enableTranslator`. | Giảm nhận thức tải, onboarding tốt hơn |
| **P3** ✅ **Đã xử lý** (2026-08-06) | **Git tree:** commit sạch working tree (tách commit Kiro removal + eval fixes). TS migration ghi nhận là **khuyến nghị dài hạn** (chưa thực hiện để tránh break). | Độ tin cậy & maintainability |

---
*Đánh giá dựa trên khảo sát: `package.json`, `README.md`, `CLAUDE.md`, `next.config.mjs`, `src/app/globals.css`, `Sidebar.js`, `Button.js`, `DashboardLayout.js`, `providers/page.js`, `landing/page.js`, `i18n/config.js`, và quét mã nguồn. Không có mã nào bị thay đổi.*
