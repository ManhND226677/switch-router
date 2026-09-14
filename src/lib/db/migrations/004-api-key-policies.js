// 004: Chính sách cho virtual API key — allowlist model, budget tháng,
// rate-limit RPM, thời hạn hiệu lực.
//
// Mọi cột mới đều nullable và mặc định "không giới hạn" để các khoá cũ tạo
// trước migration tiếp tục hoạt động y nguyên (local-first, opt-in policy).

const migration = {
  version: 4,
  name: "api-key-policies",
  up(db) {
    // Snapshot an toàn KHÔNG nằm ở đây: migrate.js tự chụp backupDbLite(adapter, …)
    // trước cả chuỗi migration (cờ backupSchemaVersion). Bản snapshot từng có ở
    // đây gọi sai chữ ký backupDbLite(dbFilePath, …) (truyền path thay vì adapter,
    // thiếu destDir) và luôn chết trong catch rỗng — đã bỏ hẳn.

    const cols = db.all(`PRAGMA table_info(apiKeys)`).map((c) => c.name);
    const addCol = (name, ddl) => {
      if (!cols.includes(name)) db.run(`ALTER TABLE apiKeys ADD COLUMN ${name} ${ddl}`);
    };
    // JSON array model/combo id được phép dùng; NULL hoặc rỗng = mọi model
    addCol("allowedModels", "TEXT");
    // Trần chi phí USD trong tháng dương lịch; NULL = không giới hạn
    addCol("monthlyBudgetUsd", "REAL");
    // Số request tối đa mỗi phút (sliding window); NULL = không giới hạn
    addCol("rateLimitRpm", "INTEGER");
    // ISO timestamp hết hạn; NULL = không hết hạn
    addCol("expiresAt", "TEXT");
    // ISO timestamp lần dùng hợp lệ gần nhất (phục vụ dashboard)
    addCol("lastUsedAt", "TEXT");
  },
};

export default migration;
