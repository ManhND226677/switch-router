import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToNode(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  return {
    ...extra,
    id: row.id,
    type: row.type,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function nodeToRow(n) {
  const { id, type, name, createdAt, updatedAt, ...rest } = n;
  return {
    id,
    type: type ?? null,
    name: name ?? null,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

function upsert(db, n) {
  const r = nodeToRow(n);
  db.run(
    `INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       type=excluded.type, name=excluded.name, data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.type, r.name, r.data, r.createdAt, r.updatedAt]
  );
}

export async function getProviderNodes(filter = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  if (filter.type) { where.push("type = ?"); params.push(filter.type); }
  const sql = `SELECT * FROM providerNodes${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  return db.all(sql, params).map(rowToNode);
}

export async function getProviderNodeById(id) {
  const db = await getAdapter();
  return rowToNode(db.get(`SELECT * FROM providerNodes WHERE id = ?`, [id]));
}

export async function createProviderNode(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const node = {
    id: data.id || uuidv4(),
    type: data.type,
    name: data.name,
    prefix: data.prefix,
    apiType: data.apiType,
    baseUrl: data.baseUrl,
    createdAt: now,
    updatedAt: now,
  };
  upsert(db, node);
  return node;
}

export async function updateProviderNode(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM providerNodes WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToNode(row), ...data, updatedAt: new Date().toISOString() };
    upsert(db, merged);
    result = merged;
  });
  return result;
}

export async function deleteProviderNode(id) {
  const db = await getAdapter();
  let removed = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM providerNodes WHERE id = ?`, [id]);
    if (!row) return;

    // A provider-node id is referenced by several independent stores. Keep the
    // complete delete in this repo-layer transaction so every caller gets the
    // same all-or-nothing behavior; the API route must not have to remember
    // which stores exist. Historical usage/requestDetails rows intentionally
    // remain: they are audit data, not live configuration.
    removed = rowToNode(row);

    const connectionIds = new Set(
      db.all(`SELECT id FROM providerConnections WHERE provider = ?`, [id]).map((connection) => connection.id)
    );
    db.run(`DELETE FROM providerConnections WHERE provider = ?`, [id]);
    db.run(`DELETE FROM kv WHERE scope = 'customModels' AND key LIKE ?`, [`${id}|%`]);
    // Both alias APIs exist in the codebase: the newer route stores
    // alias -> provider/model, while the legacy /api/models route stores
    // provider/model -> alias. Remove references in either column.
    db.run(`DELETE FROM kv WHERE scope = 'modelAliases' AND (key LIKE ? OR value LIKE ?)`, [`${id}/%`, `"${id}/%"`]);
    db.run(`DELETE FROM kv WHERE scope = 'disabledModels' AND key = ?`, [id]);
    db.run(`DELETE FROM kv WHERE scope = 'pricing' AND key = ?`, [id]);

    const settingsRow = db.get(`SELECT data FROM settings WHERE id = 1`);
    if (settingsRow) {
      const settings = parseJson(settingsRow.data, {});
      let settingsDirty = false;
      for (const field of ["providerStrategies", "providerThinking", "quotaVisibility"]) {
        if (settings[field] && typeof settings[field] === "object" && !Array.isArray(settings[field]) && id in settings[field]) {
          delete settings[field][id];
          settingsDirty = true;
        }
      }
      for (const field of ["claudeAutoPing", "codexAutoPing"]) {
        const connections = settings[field]?.connections;
        if (!connections || typeof connections !== "object" || Array.isArray(connections)) continue;
        for (const connectionId of connectionIds) {
          if (connectionId in connections) {
            delete connections[connectionId];
            settingsDirty = true;
          }
        }
      }
      if (settingsDirty) db.run(`UPDATE settings SET data = ? WHERE id = 1`, [stringifyJson(settings)]);
    }

    // A combo can contain this node as `provider/model`. Remove only the
    // affected member and retain the combo if other fallback members remain.
    // Empty combos are removed because getComboModels() cannot route them.
    const comboRows = db.all(`SELECT id, models FROM combos`);
    for (const combo of comboRows) {
      const models = parseJson(combo.models, []);
      if (!Array.isArray(models)) continue;
      const next = models.filter((model) => typeof model !== "string" || (model !== id && model.split("/", 1)[0] !== id));
      if (next.length === models.length) continue;
      if (next.length === 0) db.run(`DELETE FROM combos WHERE id = ?`, [combo.id]);
      else db.run(`UPDATE combos SET models = ?, updatedAt = ? WHERE id = ?`, [stringifyJson(next), new Date().toISOString(), combo.id]);
    }

    db.run(`DELETE FROM providerNodes WHERE id = ?`, [id]);
  });
  return removed;
}
