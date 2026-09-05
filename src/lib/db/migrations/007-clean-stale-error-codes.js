// 007: Sweep stale errorCode values that accumulated on healthy connections
// AFTER migration 003 ran (clearAccountError used to return early on a row
// with nothing else to clear, leaving the code stranded — see
// src/sse/services/auth.js; the runtime now nulls it, this cleans the backlog).
//
// Criteria match scripts/check-data-integrity.mjs (STALE_ERROR_CODE) exactly:
// a row "looks healthy" when testStatus === "active" and lastError is null.
// Rows marked "unavailable" or holding a lastError keep their errorCode —
// that is real diagnostics.
//
// Idempotent: once deleted, the criteria no longer match. migrate.js takes a
// pre-schema backup because SCHEMA_VERSION is bumped alongside this migration.
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const migration = {
  version: 7,
  name: "clean-stale-error-codes",
  up(db) {
    let cleared = 0;
    for (const row of db.all(`SELECT id, data FROM providerConnections`)) {
      const data = parseJson(row.data, null);
      if (!data || typeof data !== "object" || Array.isArray(data)) continue;
      if (data.errorCode == null) continue;
      if (data.testStatus !== "active" || data.lastError != null) continue;
      delete data.errorCode;
      db.run(`UPDATE providerConnections SET data = ? WHERE id = ?`, [stringifyJson(data), row.id]);
      cleared++;
    }
    if (cleared > 0) {
      console.log(`[DB][migrate] 007: cleared ${cleared} stale errorCode(s) on healthy connections`);
    }
  },
};

export default migration;
