import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    // Chính sách virtual key (migration 004) — NULL = không giới hạn
    allowedModels: parseJson(row.allowedModels, []) || [],
    monthlyBudgetUsd: row.monthlyBudgetUsd ?? null,
    rateLimitRpm: row.rateLimitRpm ?? null,
    expiresAt: row.expiresAt ?? null,
    lastUsedAt: row.lastUsedAt ?? null,
  };
}

// machineId is a machine fingerprint (also used to derive the CLI token) and is
// embedded in the key string itself — never expose it to the dashboard client.
export function sanitizeApiKey(key) {
  if (!key) return key;
  const { machineId, ...rest } = key;
  return rest;
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

/**
 * Chuẩn hoá input chính sách từ request body của dashboard API.
 * Thuần (không IO) để unit test trực tiếp. Trả { value } hoặc { error }.
 */
export function normalizeKeyPolicyInput(input = {}) {
  const out = {};
  const src = input && typeof input === "object" ? input : {};

  if ("allowedModels" in src) {
    if (src.allowedModels == null) {
      out.allowedModels = [];
    } else if (!Array.isArray(src.allowedModels)) {
      return { error: "Danh sách model phải là mảng" };
    } else {
      const list = [...new Set(
        src.allowedModels
          .filter((m) => typeof m === "string" && m.trim())
          .map((m) => m.trim())
      )];
      if (list.length > 200) return { error: "Tối đa 200 model mỗi khóa" };
      out.allowedModels = list;
    }
  }

  if ("monthlyBudgetUsd" in src) {
    if (src.monthlyBudgetUsd == null || src.monthlyBudgetUsd === "") {
      out.monthlyBudgetUsd = null;
    } else {
      const n = Number(src.monthlyBudgetUsd);
      if (!Number.isFinite(n) || n <= 0) return { error: "Ngân sách tháng phải là số dương" };
      out.monthlyBudgetUsd = Math.round(n * 10000) / 10000;
    }
  }

  if ("rateLimitRpm" in src) {
    if (src.rateLimitRpm == null || src.rateLimitRpm === "") {
      out.rateLimitRpm = null;
    } else {
      const n = Number(src.rateLimitRpm);
      if (!Number.isInteger(n) || n <= 0) return { error: "Giới hạn RPM phải là số nguyên dương" };
      out.rateLimitRpm = n;
    }
  }

  if ("expiresAt" in src) {
    if (src.expiresAt == null || src.expiresAt === "") {
      out.expiresAt = null;
    } else {
      const t = Date.parse(src.expiresAt);
      if (!Number.isFinite(t)) return { error: "Thời hạn không hợp lệ" };
      out.expiresAt = new Date(t).toISOString();
    }
  }

  return { value: out };
}

/**
 * @param {string} name
 * @param {string} machineId
 * @param {{ allowedModels?: string[], monthlyBudgetUsd?: number|null, rateLimitRpm?: number|null, expiresAt?: string|null }} [policy]
 */
export async function createApiKey(name, machineId, policy = {}) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
    allowedModels: Array.isArray(policy.allowedModels) ? policy.allowedModels : [],
    monthlyBudgetUsd: policy.monthlyBudgetUsd ?? null,
    rateLimitRpm: policy.rateLimitRpm ?? null,
    expiresAt: policy.expiresAt ?? null,
    lastUsedAt: null,
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, allowedModels, monthlyBudgetUsd, rateLimitRpm, expiresAt, lastUsedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt, stringifyJson(apiKey.allowedModels), apiKey.monthlyBudgetUsd, apiKey.rateLimitRpm, apiKey.expiresAt, apiKey.lastUsedAt]
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    // allowedModels luôn chuẩn hoá về mảng trước khi lưu
    if (!Array.isArray(merged.allowedModels)) merged.allowedModels = [];
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, allowedModels = ?, monthlyBudgetUsd = ?, rateLimitRpm = ?, expiresAt = ?, lastUsedAt = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, stringifyJson(merged.allowedModels), merged.monthlyBudgetUsd, merged.rateLimitRpm, merged.expiresAt, merged.lastUsedAt, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

// Tra cứu đầy đủ theo raw key — dùng ở hot path gateway để enforce chính sách.
// Khác validateApiKey (chỉ trả boolean): cần allowedModels/budget/RPM.
export async function getApiKeyByKey(rawKey) {
  if (!rawKey) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [rawKey]);
  return rowToKey(row);
}

/**
 * Tổng chi phí USD của một key trong tháng dương lịch hiện tại.
 * Dùng cho budget enforcement + hiển thị dashboard.
 */
export async function getKeyMonthlySpendUsd(keyRecord) {
  if (!keyRecord?.key || !keyRecord?.id) return 0;
  const db = await getAdapter();
  const { fingerprintApiKey } = await import("../helpers/apiKeyPrivacy.js");
  const fp = fingerprintApiKey(keyRecord.key);
  const now = new Date();
  const monthStartIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const row = db.get(
    // usageHistory.apiKey lưu FINGERPRINT (xem helpers/apiKeyPrivacy.js);
    // so cả raw key cho dữ liệu cũ ghi trước khi có fingerprint.
    `SELECT COALESCE(SUM(CASE WHEN CAST(cost AS REAL) > 0 THEN CAST(cost AS REAL) ELSE 0 END), 0) AS total
     FROM usageHistory
     WHERE timestamp >= ? AND (apiKey = ? OR apiKey = ?)`,
    [monthStartIso, fp, keyRecord.key]
  );
  return Number(row?.total) || 0;
}

/**
 * Map chi tiêu tháng hiện tại theo keyId: { keyId: usd }.
 * Một câu GROUP BY rồi map ngược fingerprint -> key (xem helpers/apiKeyPrivacy.js).
 */
export async function getKeySpendMapUsd() {
  const db = await getAdapter();
  const { fingerprintApiKey } = await import("../helpers/apiKeyPrivacy.js");
  const now = new Date();
  const monthStartIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const rows = db.all(
    `SELECT apiKey, SUM(CASE WHEN CAST(cost AS REAL) > 0 THEN CAST(cost AS REAL) ELSE 0 END) AS total
     FROM usageHistory
     WHERE timestamp >= ? AND apiKey IS NOT NULL
     GROUP BY apiKey`,
    [monthStartIso]
  );
  const byStoredValue = {};
  for (const r of rows) byStoredValue[r.apiKey] = Number(r.total) || 0;

  const keys = await getApiKeys();
  const map = {};
  for (const k of keys) {
    // usageHistory lưu fingerprint từ khi có helper; dữ liệu cũ hơn có thể là raw key
    map[k.id] = byStoredValue[fingerprintApiKey(k.key)] ?? byStoredValue[k.key] ?? 0;
  }
  return map;
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  return row.isActive === 1 || row.isActive === true;
}
