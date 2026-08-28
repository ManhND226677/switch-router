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

// Hot-path cache cho virtual key: gateway validate key ở middleware rồi đọc lại
// policy record trong handler — 2-3 lần SELECT mỗi request. TTL ngắn + invalidation
// khi dashboard ghi key. Vẫn là enforcement, chỉ bỏ I/O lặp trong 5s.
if (!global._apiKeysHotCache) global._apiKeysHotCache = new Map();
const keyCache = global._apiKeysHotCache;
const KEY_CACHE_TTL_MS = 5000;

// Monthly spend chỉ cần eventual consistency (TTL-only): usage writes xảy ra mỗi
// request nên invalidation-theo-usage sẽ tự đánh bại cache.
if (!global._keySpendCache) global._keySpendCache = new Map();
const spendCache = global._keySpendCache;
const SPEND_CACHE_TTL_MS = 5000;

export function invalidateApiKeysCache() {
  keyCache.clear();
  spendCache.clear();
}

async function cachedKeyLookup(rawKey, loader) {
  const hit = keyCache.get(rawKey);
  const now = Date.now();
  if (hit && hit.exp > now) return hit.value;
  const value = await loader();
  keyCache.set(rawKey, { value, exp: now + KEY_CACHE_TTL_MS });
  return value;
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
  invalidateApiKeysCache();
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
  invalidateApiKeysCache();
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  invalidateApiKeysCache();
  return (res?.changes ?? 0) > 0;
}

// Tra cứu đầy đủ theo raw key — dùng ở hot path gateway để enforce chính sách.
// Khác validateApiKey (chỉ trả boolean): cần allowedModels/budget/RPM.
export async function getApiKeyByKey(rawKey) {
  if (!rawKey) return null;
  const value = await cachedKeyLookup(rawKey, async () => {
    const db = await getAdapter();
    return rowToKey(db.get(`SELECT * FROM apiKeys WHERE key = ?`, [rawKey]));
  });
  // Copy để caller không thể mutate bản cache chung.
  return value ? { ...value } : value;
}

/**
 * Tổng chi phí USD của một key trong tháng dương lịch hiện tại.
 * Dùng cho budget enforcement + hiển thị dashboard.
 */
export async function getKeyMonthlySpendUsd(keyRecord) {
  if (!keyRecord?.key || !keyRecord?.id) return 0;
  const hit = spendCache.get(keyRecord.id);
  const now = Date.now();
  if (hit && now - hit.at < SPEND_CACHE_TTL_MS) return hit.value;
  const db = await getAdapter();
  const { fingerprintApiKey } = await import("../helpers/apiKeyPrivacy.js");
  const fp = fingerprintApiKey(keyRecord.key);
  const now2 = new Date();
  const monthStartIso = new Date(now2.getFullYear(), now2.getMonth(), 1).toISOString();
  const row = db.get(
    // usageHistory.apiKey lưu FINGERPRINT (xem helpers/apiKeyPrivacy.js);
    // so cả raw key cho dữ liệu cũ ghi trước khi có fingerprint.
    `SELECT COALESCE(SUM(CASE WHEN CAST(cost AS REAL) > 0 THEN CAST(cost AS REAL) ELSE 0 END), 0) AS total
     FROM usageHistory
     WHERE timestamp >= ? AND (apiKey = ? OR apiKey = ?)`,
    [monthStartIso, fp, keyRecord.key]
  );
  const total = Number(row?.total) || 0;
  spendCache.set(keyRecord.id, { at: now, value: total });
  return total;
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
  if (!key) return false;
  // Shares the full-row cache with getApiKeyByKey: the hot path validates in the
  // middleware then reads the policy record in the handler — one cached row
  // serves both instead of two SELECTs (and the values can never disagree).
  const row = await cachedKeyLookup(key, async () => {
    const db = await getAdapter();
    return rowToKey(db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]));
  });
  return !!row && row.isActive === true;
}
