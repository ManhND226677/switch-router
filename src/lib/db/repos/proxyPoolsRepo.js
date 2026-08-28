import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToPool(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  return {
    ...extra,
    id: row.id,
    isActive: row.isActive === 1 || row.isActive === true,
    testStatus: row.testStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function poolToRow(p) {
  const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
  return {
    id,
    isActive: isActive === false ? 0 : 1,
    testStatus: testStatus ?? null,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

function upsert(db, p) {
  const r = poolToRow(p);
  db.run(
    `INSERT INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       isActive=excluded.isActive, testStatus=excluded.testStatus,
       data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.isActive, r.testStatus, r.data, r.createdAt, r.updatedAt]
  );
}

// Hot-path cache for no-auth free-provider proxy rotation (getProviderCredentials).
if (!global._proxyPoolsListCache) global._proxyPoolsListCache = new Map();
const listCache = global._proxyPoolsListCache;
const LIST_CACHE_TTL_MS = 2000;

// By-id cache: resolveConnectionProxyConfig tra cứu pool theo id trên selection
// path mỗi request — trước đây luôn là SELECT thẳng, không qua cache.
if (!global._proxyPoolsByIdCache) global._proxyPoolsByIdCache = new Map();
const byIdCache = global._proxyPoolsByIdCache;

function listCacheKey(filter = {}) {
  return `${filter.isActive === undefined ? "*" : filter.isActive ? "1" : "0"}|${filter.testStatus || "*"}`;
}

export function invalidateProxyPoolsCache() {
  listCache.clear();
  byIdCache.clear();
}

export async function getProxyPools(filter = {}) {
  const key = listCacheKey(filter);
  const hit = listCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < LIST_CACHE_TTL_MS) {
    return hit.list.map((p) => ({ ...p }));
  }

  const db = await getAdapter();
  const where = [];
  const params = [];
  if (filter.isActive !== undefined) { where.push("isActive = ?"); params.push(filter.isActive ? 1 : 0); }
  if (filter.testStatus) { where.push("testStatus = ?"); params.push(filter.testStatus); }
  const sql = `SELECT * FROM proxyPools${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  const list = db.all(sql, params).map(rowToPool);
  list.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  listCache.set(key, { at: now, list });
  return list.map((p) => ({ ...p }));
}

export async function getProxyPoolById(id) {
  if (!id) return null;
  const now = Date.now();
  const hit = byIdCache.get(id);
  if (hit && now - hit.at < LIST_CACHE_TTL_MS) {
    return hit.pool ? { ...hit.pool } : hit.pool;
  }
  const db = await getAdapter();
  const pool = rowToPool(db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]));
  byIdCache.set(id, { at: now, pool });
  return pool ? { ...pool } : pool;
}

export async function createProxyPool(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const pool = {
    id: data.id || uuidv4(),
    name: data.name,
    proxyUrl: data.proxyUrl,
    noProxy: data.noProxy || "",
    type: data.type || "http",
    isActive: data.isActive !== undefined ? data.isActive : true,
    strictProxy: data.strictProxy === true,
    testStatus: data.testStatus || "unknown",
    lastTestedAt: data.lastTestedAt || null,
    lastError: data.lastError || null,
    createdAt: now,
    updatedAt: now,
  };
  upsert(db, pool);
  invalidateProxyPoolsCache();
  return pool;
}

export async function updateProxyPool(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToPool(row), ...data, updatedAt: new Date().toISOString() };
    upsert(db, merged);
    result = merged;
  });
  if (result) invalidateProxyPoolsCache();
  return result;
}

export async function deleteProxyPool(id) {
  const db = await getAdapter();
  let removed = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]);
    if (!row) return;
    removed = rowToPool(row);
    db.run(`DELETE FROM proxyPools WHERE id = ?`, [id]);

    // A dangling proxyPoolId makes resolveConnectionProxyConfig fall through to
    // "no proxy" — the connection would silently start going DIRECT and lose the
    // pool's strictProxy guard, so clear the reference while the pool is gone.
    const candidates = db.all(
      `SELECT id, data FROM providerConnections WHERE data LIKE ?`,
      [`%"${id}"%`]
    );
    for (const candidate of candidates) {
      const data = parseJson(candidate.data, null);
      if (!data?.providerSpecificData || data.providerSpecificData.proxyPoolId !== id) continue;
      data.providerSpecificData.proxyPoolId = "";
      db.run(`UPDATE providerConnections SET data = ? WHERE id = ?`, [stringifyJson(data), candidate.id]);
    }
  });
  if (removed) {
    invalidateProxyPoolsCache();
    // Connections were rewritten → their cached providerSpecificData is stale.
    const { invalidateConnectionsCache } = await import("./connectionsRepo.js");
    invalidateConnectionsCache();
  }
  return removed;
}
