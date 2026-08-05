# Windows tray & auto-start (Switch-Router)

Tùy chọn chỉ dành cho Windows. Mục tiêu: có biểu tượng ở khay hệ thống và tự khởi
động khi đăng nhập, **không** thay đổi bất cứ thứ gì về runtime của gateway.

## Cam kết phạm vi

Các script này:

- chỉ chạy lại đúng lệnh `npm start` (tức `node custom-server.js`) của repo;
- đọc `PORT`/`HOSTNAME` từ `.env.local`, rồi `.env`, đúng thứ tự như `custom-server.js` — không tự đặt biến môi trường;
- không sửa `.env`, `.env.local`, không đổi endpoint, không đổi cổng `28701`;
- không tạo Windows Service, không tạo Scheduled Task, không ghi `HKLM`;
- chỉ tạo **một** shortcut trong Startup của user hiện tại;
- khi Stop/Restart chỉ kill tiến trình `node.exe` thuộc chính thư mục checkout này. Nếu cổng đang bị một tiến trình khác giữ, tray báo cảnh báo và **không** kill.

## File

| File | Vai trò |
| --- | --- |
| `scripts/windows/generate-icon.mjs` | Sinh `public/icons/switch-router.ico` (16→256 px) + PNG preview, thuần Node, không cần thư viện ảnh |
| `scripts/windows/lib/router-runtime.ps1` | Logic dò tiến trình / start / stop / restart / auto-start (tách riêng để test được, không cần UI) |
| `scripts/windows/tray.ps1` | Tray `NotifyIcon` + menu |
| `scripts/windows/switch-router-tray.vbs` | Chạy `tray.ps1` ẩn hoàn toàn (không cửa sổ console) |
| `scripts/windows/install-autostart.ps1` | Cài / gỡ / kiểm tra shortcut Startup của user hiện tại |

## Lệnh

```bash
npm run icon              # sinh lại icon
npm run tray              # tray + khởi động server
npm run tray:hidden       # tray ẩn, không cửa sổ console
npm run autostart         # bật auto-start cho user hiện tại
npm run autostart:status  # xem trạng thái
npm run autostart:remove  # tắt auto-start
```

Tham số trực tiếp của `tray.ps1`:

```powershell
# chỉ hiện tray, không tự start server
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/tray.ps1 -NoStart

# tự kiểm tra không cần UI: in trạng thái, không start/stop gì
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/tray.ps1 -SelfTest
```

## Menu tray

- **Open dashboard** — mở `http://127.0.0.1:28701/dashboard` (double-click icon cũng được)
- **Copy base URL** — copy `http://127.0.0.1:28701`
- **Start / Stop / Restart server**
- **Open logs folder** — `logs/switch-router-production.{out,err}.log`
- **Start with Windows** — bật/tắt auto-start (có dấu check)
- **Exit tray (keep server running)** — chỉ thoát tray, server vẫn chạy
- **Quit server and tray** — dừng cả hai

Dòng đầu menu là trạng thái: `running` (health 200), `starting` (đã có tiến trình
nhưng `/api/health` chưa trả 200), hoặc `stopped`.

## Auto-start

```text
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Switch-Router.lnk
  → C:\Windows\System32\wscript.exe //nologo "<repo>\scripts\windows\switch-router-tray.vbs"
  WorkingDirectory: <repo>
  WindowStyle: 7 (minimized/hidden)
  Icon: public\icons\switch-router.ico
```

Chỉ áp dụng cho user Windows hiện tại. Gỡ bằng `npm run autostart:remove` hoặc xóa
tay file `.lnk` đó.

## Icon

Icon được **vẽ mới** (ô bo góc gradient indigo→cyan + hai mũi tên định tuyến hai
chiều), không dùng lại nhãn 9router. Bộ SVG của web/PWA (`public/favicon.svg`,
`public/icons/icon-192.svg`, `public/icons/icon-512.svg`) đã được đổi sang cùng
hình này thay cho chữ “9”/“9R” cũ.

`generate-icon.mjs` không cần ImageMagick/Inkscape: nó tự dựng bitmap RGBA
(supersample 3×3), đóng gói ICO 32bpp cho 7 kích thước và ghi PNG bằng `zlib`.

## Khắc phục sự cố

| Hiện tượng | Nguyên nhân / xử lý |
| --- | --- |
| Tray hiện “Standalone build not found” | chưa build → chạy `npm run build` |
| Bấm Stop nhưng báo “held by PID … not this checkout” | cổng `28701` đang do tiến trình ngoài checkout này giữ; tray cố ý không kill. Tự kiểm tra bằng `netstat -ano | findstr 28701` |
| Không thấy icon sau khi đăng nhập | kiểm tra `npm run autostart:status`; nếu `enabled` mà vẫn không thấy, chạy thử `npm run tray:hidden` để xem lỗi |
| Chặn bởi ExecutionPolicy | các script npm đã truyền `-ExecutionPolicy Bypass`; nếu chạy tay thì thêm tham số đó |
| Muốn kiểm tra nhanh mà không mở UI | `npm run tray -- -SelfTest` hoặc lệnh `-SelfTest` ở trên |

## Không liên quan tới Office gateway

Tray không bật/tắt `OFFICE_GATEWAY_ENABLED` và không chạm `/office/v1/*`. Cấu hình
Claude for M365 vẫn theo [CLAUDE-OFFICE.vi.md](CLAUDE-OFFICE.vi.md).
