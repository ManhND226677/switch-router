import fs from "node:fs";
import initSqlJs from "sql.js";
import { PRAGMA_SQL } from "../schema.js";

let SQL = null;

async function loadSql() {
  if (SQL) return SQL;
  SQL = await initSqlJs();
  return SQL;
}

export async function createSqlJsAdapter(filePath) {
  const SQLLib = await loadSql();
  const buf = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;

  // sql.js is a pure in-memory WASM SQLite: it CANNOT replay a native-driver
  // -wal/-shm sidecar. If one is left behind by a previous better-sqlite3 /
  // node:sqlite / bun:sqlite run that subsequently fell back to this adapter,
  // the on-disk main file is already stale relative to the WAL (un-checkpointed
  // writes are silently dropped by sql.js). Worse, leaving the sidecar around
  // would later confuse a native driver, which could try to apply a stale WAL
  // against sql.js's exported main file. So: warn loudly, and remove the orphan
  // sidecars so we start from a self-consistent on-disk state.
  for (const sidecar of [filePath + "-wal", filePath + "-shm"]) {
    if (fs.existsSync(sidecar)) {
      console.warn(`[sqljs] orphan WAL sidecar detected (${sidecar}) — sql.js cannot replay it; dropping un-checkpointed writes and removing sidecar.`);
      try { fs.unlinkSync(sidecar); } catch (e) { console.error(`[sqljs] failed to remove sidecar ${sidecar}:`, e); }
    }
  }

  const db = new SQLLib.Database(buf);
  db.exec(PRAGMA_SQL);
  // Schema is created/synced by migrate.js after adapter init

  let dirty = false;
  let saveTimer = null;
  const SAVE_DEBOUNCE_MS = 100;

  function persist() {
    const data = db.export();
    // Atomic replace: write to a temp file then rename, so a kill -9 mid-write
    // cannot leave a truncated/corrupt DB file.
    const tmp = filePath + ".tmp";
    fs.writeFileSync(tmp, Buffer.from(data));
    fs.renameSync(tmp, filePath);
    dirty = false;
  }

  function scheduleSave() {
    dirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (dirty) {
        try { persist(); } catch (e) { console.error("[sqljs] save failed:", e); }
      }
    }, SAVE_DEBOUNCE_MS);
  }

  function paramsObj(params) {
    if (!params || (Array.isArray(params) && params.length === 0)) return undefined;
    return params;
  }

  // sql.js prepare() compiles WASM SQLite statements per call — cache them like
  // the native adapters do. Statements are reset() after use, freed in close().
  const stmtCache = new Map();
  function prepare(sql) {
    let stmt = stmtCache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  function run(sql, params = []) {
    const stmt = prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      stmt.step();
      const changes = db.getRowsModified();
      const lastInsertRowid = db.exec("SELECT last_insert_rowid() as id")[0]?.values?.[0]?.[0] ?? null;
      scheduleSave();
      return { changes, lastInsertRowid };
    } finally {
      try { stmt.reset(); } catch {}
    }
  }

  function get(sql, params = []) {
    const stmt = prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      if (stmt.step()) return stmt.getAsObject();
      return undefined;
    } finally {
      try { stmt.reset(); } catch {}
    }
  }

  function all(sql, params = []) {
    const stmt = prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      try { stmt.reset(); } catch {}
    }
  }

  function exec(sql) {
    db.exec(sql);
    scheduleSave();
  }

  function transaction(fn) {
    const sp = `sp_${Math.random().toString(36).slice(2)}`;
    db.exec(`SAVEPOINT ${sp}`);
    try {
      const result = fn();
      db.exec(`RELEASE ${sp}`);
      scheduleSave();
      return result;
    } catch (e) {
      try { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); } catch {}
      throw e;
    }
  }

  function close() {
    if (saveTimer) clearTimeout(saveTimer);
    if (dirty) persist();
    for (const stmt of stmtCache.values()) {
      try { stmt.free(); } catch {}
    }
    stmtCache.clear();
    db.close();
  }

  // Flush on shutdown
  const flush = () => { if (dirty) try { persist(); } catch {} };
  process.on("beforeExit", flush);
  process.on("SIGINT", flush);
  process.on("SIGTERM", flush);

  return { driver: "sql.js", run, get, all, exec, transaction, close, raw: db };
}
