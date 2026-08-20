import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToCombo(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    models: parseJson(row.models, []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Hot-path cache for chat combo resolution (getComboByName / getComboModels).
// Combos change rarely; invalidate on every write. TTL is a safety net only.
if (!global._combosCache) global._combosCache = { at: 0, byName: null, list: null, inflight: null };
const combosCache = global._combosCache;
const COMBOS_CACHE_TTL_MS = 5000;

export function invalidateCombosCache() {
  combosCache.at = 0;
  combosCache.byName = null;
  combosCache.list = null;
  combosCache.inflight = null;
}

async function loadCombosMaps() {
  const now = Date.now();
  if (combosCache.byName && now - combosCache.at < COMBOS_CACHE_TTL_MS) {
    return { list: combosCache.list, byName: combosCache.byName };
  }
  if (combosCache.inflight) return combosCache.inflight;

  combosCache.inflight = (async () => {
    try {
      const db = await getAdapter();
      const rows = db.all(`SELECT * FROM combos ORDER BY createdAt ASC`);
      const list = rows.map(rowToCombo);
      const byName = new Map();
      for (const c of list) {
        if (c?.name) byName.set(c.name, c);
      }
      combosCache.list = list;
      combosCache.byName = byName;
      combosCache.at = Date.now();
      return { list, byName };
    } finally {
      combosCache.inflight = null;
    }
  })();

  return combosCache.inflight;
}

export async function getCombos() {
  const { list } = await loadCombosMaps();
  // Shallow-copy list + models array so callers can mutate safely.
  return list.map((c) => ({ ...c, models: Array.isArray(c.models) ? [...c.models] : [] }));
}

export async function getComboById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
  return rowToCombo(row);
}

export async function getComboByName(name) {
  if (!name) return null;
  const { byName } = await loadCombosMaps();
  const hit = byName.get(name);
  if (!hit) return null;
  return { ...hit, models: Array.isArray(hit.models) ? [...hit.models] : [] };
}

export async function createCombo(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const combo = {
    id: uuidv4(),
    name: data.name,
    kind: data.kind || null,
    models: data.models || [],
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models), combo.createdAt, combo.updatedAt]
  );
  invalidateCombosCache();
  return combo;
}

export async function updateCombo(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToCombo(row), ...data, updatedAt: new Date().toISOString() };
    db.run(
      `UPDATE combos SET name = ?, kind = ?, models = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), merged.updatedAt, id]
    );
    result = merged;
  });
  if (result) invalidateCombosCache();
  return result;
}

export async function deleteCombo(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM combos WHERE id = ?`, [id]);
  const ok = (res?.changes ?? 0) > 0;
  if (ok) invalidateCombosCache();
  return ok;
}
