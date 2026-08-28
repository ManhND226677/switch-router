// Persistence for the per-connection latency EWMA that drives the "fastest"
// routing strategy (open-sse/services/connectionLatency.js).
//
// Stored as ONE kv row rather than one row per connection: the whole map is
// small (a handful of fields per connection) and is always read and written as
// a unit at boot / flush, so a single upsert keeps the write-behind cheap and
// atomic.
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const SCOPE = "connLatency";
const KEY = "ewma";

/** @returns {Promise<Object<string, {ewmaTtftMs:number|null,ewmaTotalMs:number|null,samples:number,lastSampleAt:number}>>} */
export async function readLatencySnapshots() {
  const db = await getAdapter();
  const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, KEY]);
  if (!row) return {};
  const parsed = parseJson(row.value, null);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

/** Replace the stored map in one upsert. Empty object clears the row. */
export async function writeLatencySnapshots(snapshots) {
  const db = await getAdapter();
  const entries = snapshots && typeof snapshots === "object" ? snapshots : {};
  const ids = Object.keys(entries);
  if (ids.length === 0) {
    db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [SCOPE, KEY]);
    return 0;
  }
  db.run(
    `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?)
     ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
    [SCOPE, KEY, stringifyJson(entries)]
  );
  return ids.length;
}
