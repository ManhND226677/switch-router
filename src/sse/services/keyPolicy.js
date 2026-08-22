// Đánh giá chính sách virtual key — hàm thuần, không đụng DB/IO để unit test
// trực tiếp. Thứ tự kiểm tra: hết hạn → allowlist model → (budget do caller
// tổng hợp từ usageHistory rồi truyền vào).
import { parseJson } from "@/lib/db/helpers/jsonCol.js";

/**
 * @param {object|null} keyRecord - bản ghi từ apiKeysRepo
 * @param {string|null} modelStr  - model/combo id client yêu cầu
 * @returns {{ ok: boolean, code: "expired"|"model_not_allowed"|null }}
 */
export function checkKeyPolicy(keyRecord, modelStr) {
  if (!keyRecord || !keyRecord.isActive) return { ok: true }; // không phải việc của hàm này

  const nowIso = Date.now();
  const expiresAt = keyRecord.expiresAt ? Date.parse(keyRecord.expiresAt) : NaN;
  if (Number.isFinite(expiresAt) && expiresAt <= nowIso) {
    return { ok: false, code: "expired" };
  }

  const allowed = parseJson(keyRecord.allowedModels, []);
  if (!Array.isArray(allowed) || allowed.length === 0) {
    return { ok: true }; // rỗng = mọi model
  }
  // So khớp chính xác model/combo id client gửi lên
  if (!modelStr || !allowed.includes(modelStr)) {
    return { ok: false, code: "model_not_allowed" };
  }
  return { ok: true };
}

/**
 * Budget tháng dương lịch: so tiêu thực tế với trần của key.
 * @param {number|undefined} monthlyBudgetUsd
 * @param {number} spentUsd - đã tổng hợp từ usageHistory cho tháng hiện tại
 * @returns {{ ok: boolean, code: "budget_exceeded"|null }}
 */
export function checkBudget(monthlyBudgetUsd, spentUsd) {
  const cap = Number(monthlyBudgetUsd);
  if (!Number.isFinite(cap) || cap <= 0) return { ok: true };
  const spent = Number(spentUsd) || 0;
  if (spent >= cap) return { ok: false, code: "budget_exceeded" };
  return { ok: true };
}
