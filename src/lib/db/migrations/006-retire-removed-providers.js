// 006: Dọn dữ liệu còn sót sau khi gỡ 4 provider khỏi registry ở 0.10.9
// (xai, cursor, commandcode, xiaomi-mimo).
//
// Kết quả: các dòng `providerConnections` của 4 id này vẫn còn trong DB của
// người dùng nâng cấp từ bản cũ → dashboard Providers vẫn hiện connection và
// mọi request qua nó chết ở bước chọn executor.
//
// CHỈ tắt (isActive = 0), KHÔNG xoá: token OAuth/key của người dùng vẫn nằm
// trong cột `data`, xoá là mất quyền truy hồi. Người dùng muốn dùng lại thì
// bật thủ công qua API settings/connections như mọi connection khác.
// Migration này chạy idempotent (giống 005).
//
// Lưu ý: `grok-cli`/`grok-web` (cùng dòng xAI) và `xiaomi-tokenplan` là
// provider riêng, vẫn còn trong registry — KHÔNG đụng tới.
//
// RETIRED_PROVIDERS export để test lấy đúng danh sách này thay vì hardcode tên
// provider đã gỡ — scripts/qa-provider-drift.mjs fail nếu file test nhắc tới
// một provider không còn trong registry.
// SCHEMA_VERSION đã bump lên 6 kèm migration này (data-repair-regression bắt
// latestVersion() === SCHEMA_VERSION), nên migrate.js cũng tự chụp một bản
// backup trước khi áp dụng.
export const RETIRED_PROVIDERS = ["xai", "cursor", "commandcode", "xiaomi-mimo"];

const migration = {
  version: 6,
  name: "retire-removed-providers",
  up(db) {
    for (const provider of RETIRED_PROVIDERS) {
      const result = db.run(
        `UPDATE providerConnections SET isActive = 0, updatedAt = ? WHERE provider = ? AND isActive != 0`,
        [new Date().toISOString(), provider]
      );
      const deactivated = result?.changes || 0;
      if (deactivated > 0) {
        console.log(`[DB][migrate] 006: tắt ${deactivated} connection của provider đã gỡ "${provider}" (giữ nguyên credential, bật lại thủ công nếu cần)`);
      }
    }
  },
};

export default migration;
