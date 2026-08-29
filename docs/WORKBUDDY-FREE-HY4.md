# WorkBuddy AI — đăng nhập & dùng free Hy4 Preview

WorkBuddy AI là desktop app (bản rebrand của Tencent CodeBuddy). Gateway tích hợp nó
thành provider `workbuddy` (alias `wb`), xếp trong nhóm **OAuth Providers** trên
dashboard. Tại thời điểm viết bài, `hy4-preview` và `hy3` đang chạy gói dùng thử
**free** (promo `*-free-trial-202608`) — không trừ credit.

## Cách 1 — máy có cài app WorkBuddy AI (khuyến nghị)

1. Cài và đăng nhập app WorkBuddy AI như bình thường.
2. Mở dashboard → **Providers** → nhóm **OAuth Providers** → **WorkBuddy AI**.
3. Bấm nút **OAuth** — gateway import thẳng session của app đang đăng nhập:
   không mở tab browser, modal báo thành công ngay, connection chuyển `active`.

Tương đương: tạo connection với API key = `auto` — executor tự đọc file session
của app (`%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth\workbuddy-desktop-ai.info`)
mỗi request, nên token luôn theo kịp mỗi khi app tự refresh.

## Thêm tài khoản thứ hai (nhiều connection song song)

Mỗi tài khoản WorkBuddy nhận connection riêng (phân biệt theo uid trong JWT):

1. Trang WorkBuddy AI bấm **OAuth (Web Login)** — flow này luôn mở trang đăng nhập
   web thật, kể cả khi app desktop đang đăng nhập (nút **OAuth** thường thì import
   app session).
2. Đăng nhập tài khoản mới (QR WeChat / TencentCloud). Modal poll và tạo connection
   mới khi login hoàn tất — connection đặt tên theo **email/tên tài khoản** (lấy từ
   Keycloak userinfo; mất mạng chỉ làm rơi tên về nickname mặc định).
3. Lặp lại cho từng tài khoản. Đăng nhập lại một tài khoản đã có thì chỉ refresh
   connection của nó, không tạo trùng (tên user tự đặt bằng Edit được giữ nguyên).

Quirk phía WorkBuddy (giữ nguyên như ghi dưới Cách 2): browser **đã có phiên web**
workbuddy.ai của tài khoản cũ thì trang login nhảy thẳng `/login/started` và không
bàn giao state → dùng cửa sổ ẩn danh (incognito) hoặc logout phiên web cũ trước khi
login tài khoản mới.

## Cách 2 — máy không cài app (login web)

1. Bấm **OAuth** trên trang WorkBuddy AI.
2. Modal mở trang đăng nhập thật `https://www.workbuddy.ai/login?...` — đăng nhập
   (QR WeChat / TencentCloud).
3. Modal poll và bắt session tự refresh được khi login hoàn tất.

Lưu ý quirk phía WorkBuddy: nếu browser **đã có sẵn phiên web** workbuddy.ai, trang
login nhảy thẳng sang `/login/started` ("Login Successful") nhưng **không** bàn giao
state cho backend → poll không bao giờ nhận. Gặp cảnh này thì dùng Cách 1 hoặc Cách 3.

## Cách 3 — paste token thủ công

Lấy `accessToken` (JWT) từ file session của app (đường dẫn ở Cách 1) và dán vào ô
API key khi tạo connection. JWT sống ~11 tháng.

## Gọi model

```bash
curl http://127.0.0.1:28701/v1/chat/completions \
  -H "Authorization: Bearer <virtual-key>" -H "Content-Type: application/json" \
  -d '{"model":"wb/hy4-preview","messages":[{"role":"user","content":"hi"}]}'
```

- Cả `stream: true` lẫn `stream: false` đều được (upstream chỉ nhận SSE; gateway
  tự ép stream và chuyển lại JSON khi client không stream).
- 19 model: `wb/hy4-preview`, `wb/hy3`, `wb/gpt-5.6-sol`, `wb/gemini-3.5-flash`,
  `wb/kimi-k3`, … — xem danh sách đầy đủ trên trang provider hoặc `GET /v1/models`.
- `hy4-preview`: context 1M token, reasoning + vision.

## Vận hành

- Connection tạo bằng OAuth/web login giữ token riêng và **tự refresh** khi gặp 401
  (`POST /v2/plugin/auth/token/refresh`) — không cần mở app.
- Connection `auto` phụ thuộc app: máy phải có app đang đăng nhập; app tự ghi lại
  file session mỗi lần refresh.
- Hết promo free (`202608`) thì `hy4-preview`/`hy3` trừ credit như model thường —
  các model còn lại luôn trừ credit của tài khoản.
- Đổi tài khoản trong app → bấm **OAuth** lại để import tài khoản mới (connection
  cũ cùng uid được refresh, không tạo trùng). Thêm tài khoản khác song song → dùng
  **OAuth (Web Login)**, xem mục "Thêm tài khoản thứ hai".
