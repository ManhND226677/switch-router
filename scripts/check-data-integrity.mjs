#!/usr/bin/env node
// Read-only data integrity check for the local SQLite store.
//
// Run it any time to catch the defect classes found in the 2026-08-05 audit
// before they grow: dangling provider references, orphaned usage rows, plaintext
// gateway keys, unbounded modelLock_* growth and settings drift.
//
// SAFETY: never opens the live DB. It copies data.sqlite (+ -wal/-shm) to a temp
// dir and inspects the copy, so it is safe to run while the gateway is serving.
//
// Usage:
//   node --import ./scripts/alias-register.mjs scripts/check-data-integrity.mjs
//   node --import ./scripts/alias-register.mjs scripts/check-data-integrity.mjs --json
//
// Exit code: 0 = clean, 1 = at least one ERROR-level finding, 2 = could not run.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const asJson = process.argv.includes("--json");

// Silence node:sqlite's experimental warning before the dynamic import.
const origEmit = process.emit;
process.emit = function (name, data, ...rest) {
  if (name === "warning" && data?.name === "ExperimentalWarning" && /SQLite/i.test(data.message || "")) return false;
  return origEmit.call(process, name, data, ...rest);
};

const findings = [];
function add(level, code, message, detail = null) {
  findings.push({ level, code, message, detail });
}

let tmpDir = null;
try {
  const { DATA_FILE } = await import("../src/lib/db/paths.js");
  const { isFingerprinted } = await import("../src/lib/db/helpers/apiKeyPrivacy.js");

  if (!fs.existsSync(DATA_FILE)) {
    console.error(`[check] no database at ${DATA_FILE} — nothing to check`);
    process.exit(2);
  }

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sr-integrity-"));
  const copy = path.join(tmpDir, "data.sqlite");
  for (const suffix of ["", "-wal", "-shm"]) {
    const src = DATA_FILE + suffix;
    if (fs.existsSync(src)) fs.copyFileSync(src, copy + suffix);
  }

  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(copy);
  const all = (sql, p = []) => db.prepare(sql).all(...p);
  const get = (sql, p = []) => db.prepare(sql).get(...p);
  const J = (v, d = null) => { try { return JSON.parse(v); } catch { return d; } };

  // ── structural ─────────────────────────────────────────────────────────
  const integrity = get(`PRAGMA integrity_check`)?.integrity_check;
  if (integrity !== "ok") add("ERROR", "DB_CORRUPT", `integrity_check returned "${integrity}"`);
  const fkViolations = all(`PRAGMA foreign_key_check`);
  if (fkViolations.length) add("ERROR", "FK_VIOLATION", `${fkViolations.length} foreign key violation(s)`);

  const tableNames = new Set(
    all(`SELECT name FROM sqlite_master WHERE type='table'`).map((r) => r.name)
  );
  const need = (t) => tableNames.has(t);

  // ── 1. plaintext gateway keys ──────────────────────────────────────────
  if (need("usageHistory")) {
    const raw = all(`SELECT id, apiKey FROM usageHistory WHERE apiKey IS NOT NULL AND apiKey <> ''`)
      .filter((r) => !isFingerprinted(r.apiKey));
    if (raw.length) {
      add("ERROR", "PLAINTEXT_KEY_USAGE",
        `${raw.length} usageHistory row(s) store an unfingerprinted gateway key`,
        { rowIds: raw.slice(0, 20).map((r) => r.id) });
    }
  }

  if (need("usageDaily")) {
    let leaks = 0;
    for (const row of all(`SELECT dateKey, data FROM usageDaily`)) {
      const day = J(row.data, {}) || {};
      for (const [bucketKey, bucket] of Object.entries(day.byApiKey || {})) {
        const rawKey = String(bucketKey).split("|")[0];
        if (rawKey && rawKey !== "local-no-key" && !isFingerprinted(rawKey)) leaks++;
        // addToCounter() spreads meta FLAT onto the bucket, so the key lands at
        // bucket.apiKey; older shapes may nest it under bucket.meta.apiKey.
        if (bucket?.apiKey && !isFingerprinted(bucket.apiKey)) leaks++;
        if (bucket?.meta?.apiKey && !isFingerprinted(bucket.meta.apiKey)) leaks++;
      }
    }
    if (leaks) {
      add("ERROR", "PLAINTEXT_KEY_DAILY",
        `${leaks} plaintext gateway key occurrence(s) in usageDaily.byApiKey`);
    }
  }

  // ── 2. dangling dynamic provider references ────────────────────────────
  const DYNAMIC = ["openai-compatible-chat-", "openai-compatible-responses-", "anthropic-compatible-", "custom-embedding-"];
  const isDynamic = (id) => typeof id === "string" && DYNAMIC.some((p) => id.startsWith(p));
  const liveNodes = need("providerNodes")
    ? new Set(all(`SELECT id FROM providerNodes`).map((r) => r.id)) : new Set();

  if (need("kv")) {
    const deadCustom = [];
    for (const row of all(`SELECT key, value FROM kv WHERE scope='customModels'`)) {
      const alias = J(row.value, {})?.providerAlias ?? String(row.key).split("|")[0];
      if (isDynamic(alias) && !liveNodes.has(alias)) deadCustom.push(row.key);
    }
    if (deadCustom.length) {
      add("WARN", "DANGLING_CUSTOM_MODEL",
        `${deadCustom.length} customModels reference a deleted provider-node`,
        { hint: "migration 003 cleans these; a new occurrence means the node-delete cascade regressed" });
    }

    const deadAlias = [];
    for (const row of all(`SELECT key, value FROM kv WHERE scope='modelAliases'`)) {
      const target = J(row.value, row.value);
      if (typeof target !== "string") continue;
      const provider = target.split("/")[0];
      if (isDynamic(provider) && !liveNodes.has(provider)) deadAlias.push(row.key);
    }
    if (deadAlias.length) {
      add("ERROR", "DANGLING_ALIAS",
        `${deadAlias.length} model alias(es) resolve to a deleted provider-node → requests 404`,
        { aliases: deadAlias.slice(0, 20) });
    }
  }

  // ── 3. settings drift ──────────────────────────────────────────────────
  if (need("settings")) {
    const settings = J(get(`SELECT data FROM settings WHERE id=1`)?.data, {}) || {};
    const comboNames = need("combos")
      ? new Set(all(`SELECT name FROM combos`).map((r) => r.name)) : new Set();
    const connIds = need("providerConnections")
      ? new Set(all(`SELECT id FROM providerConnections`).map((r) => r.id)) : new Set();

    const staleCombo = Object.keys(settings.comboStrategies || {}).filter((n) => !comboNames.has(n));
    if (staleCombo.length) {
      add("WARN", "STALE_COMBO_STRATEGY",
        `${staleCombo.length} comboStrategies key(s) match no combo (lookup is exact-match → never read)`,
        { keys: staleCombo.slice(0, 20) });
    }

    const deadStrategy = Object.keys(settings.providerStrategies || {}).filter((p) => isDynamic(p) && !liveNodes.has(p));
    if (deadStrategy.length) {
      add("WARN", "STALE_PROVIDER_STRATEGY",
        `${deadStrategy.length} providerStrategies key(s) reference a deleted provider-node`);
    }

    const deadPing = Object.keys(settings.codexAutoPing?.connections || {}).filter((id) => !connIds.has(id));
    if (deadPing.length) {
      add("WARN", "STALE_AUTOPING_CONNECTION",
        `${deadPing.length} codexAutoPing connection id(s) no longer exist`);
    }

    // The key the observability config actually reads must be the one that gets written.
    if (settings.enableObservability2 !== undefined && settings.enableObservability === undefined) {
      add("WARN", "OBSERVABILITY_KEY_DRIFT",
        "settings store enableObservability2 but not enableObservability — the dashboard toggle writes the latter");
    }
  }

  // ── 4. unbounded modelLock_* growth ────────────────────────────────────
  if (need("providerConnections")) {
    const now = Date.now();
    let dead = 0;
    let worst = { id: null, n: 0 };
    for (const row of all(`SELECT id, data FROM providerConnections`)) {
      const data = J(row.data, {}) || {};
      const locks = Object.keys(data).filter((k) => k.startsWith("modelLock_"));
      let rowDead = 0;
      for (const k of locks) {
        const v = data[k];
        const ts = v ? new Date(v).getTime() : NaN;
        if (!v || !Number.isFinite(ts) || ts <= now) rowDead++;
      }
      dead += rowDead;
      if (locks.length > worst.n) worst = { id: row.id, n: locks.length };
    }
    if (dead) {
      add("WARN", "DEAD_MODEL_LOCKS",
        `${dead} expired/cleared modelLock_* key(s) still stored (pruned on next connection write)`,
        { largestConnection: worst });
    }
  }

  // ── 5. orphaned usage/observability references ──────────────────────────
  if (need("providerConnections")) {
    if (need("usageHistory")) {
      const orphan = get(`SELECT COUNT(*) c FROM usageHistory u
        LEFT JOIN providerConnections p ON p.id = u.connectionId
        WHERE u.connectionId IS NOT NULL AND p.id IS NULL`)?.c || 0;
      if (orphan) {
        add("INFO", "ORPHAN_USAGE_CONNECTION",
          `${orphan} usageHistory row(s) point at a deleted connection (historical data — expected)`);
      }
    }
    if (need("requestDetails")) {
      const orphan = get(`SELECT COUNT(*) c FROM requestDetails r
        LEFT JOIN providerConnections p ON p.id = r.connectionId
        WHERE r.connectionId IS NOT NULL AND p.id IS NULL`)?.c || 0;
      if (orphan) {
        add("INFO", "ORPHAN_DETAIL_CONNECTION",
          `${orphan} requestDetails row(s) point at a deleted connection (historical data — expected)`);
      }
    }
  }

  // ── 6. connection hygiene ──────────────────────────────────────────────
  if (need("providerConnections")) {
    const stale = all(`SELECT id, provider, data FROM providerConnections`)
      .map((r) => ({ ...r, d: J(r.data, {}) || {} }))
      .filter((r) => r.d.errorCode != null && r.d.testStatus === "active" && r.d.lastError == null);
    if (stale.length) {
      // clearAccountError() returns early on such a row, so the runtime can
      // never clear it — only migration 003 (or a real error/success cycle) can.
      add("WARN", "STALE_ERROR_CODE",
        `${stale.length} connection(s) keep an errorCode while looking healthy (unreachable by clearAccountError)`,
        { connections: stale.slice(0, 10).map((r) => ({ id: r.id, provider: r.provider, errorCode: r.d.errorCode })) });
    }

    const dupPriority = all(`SELECT provider, priority, COUNT(*) n FROM providerConnections
      GROUP BY provider, priority HAVING n > 1`);
    if (dupPriority.length) {
      add("WARN", "DUPLICATE_PRIORITY",
        `${dupPriority.length} provider/priority pair(s) collide — account ordering is ambiguous`);
    }
  }

  // ── 7. malformed JSON columns ──────────────────────────────────────────
  const jsonCols = [
    ["settings", "data", "id"], ["providerConnections", "data", "id"],
    ["providerNodes", "data", "id"], ["proxyPools", "data", "id"],
    ["combos", "models", "id"], ["kv", "value", "key"],
    ["usageDaily", "data", "dateKey"], ["requestDetails", "data", "id"],
  ];
  const badJson = [];
  for (const [table, col, idCol] of jsonCols) {
    if (!need(table)) continue;
    for (const row of all(`SELECT ${idCol} AS idv, ${col} AS v FROM ${table}`)) {
      if (row.v === null) { badJson.push(`${table}.${row.idv}: NULL`); continue; }
      try { JSON.parse(row.v); } catch { badJson.push(`${table}.${row.idv}: invalid JSON`); }
    }
  }
  if (badJson.length) {
    add("ERROR", "MALFORMED_JSON", `${badJson.length} malformed JSON column value(s)`, { rows: badJson.slice(0, 20) });
  }

  db.close();
} catch (err) {
  console.error(`[check] failed to run: ${err.message}`);
  if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} }
  process.exit(2);
}
if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} }

const errors = findings.filter((f) => f.level === "ERROR");
const warns = findings.filter((f) => f.level === "WARN");
const infos = findings.filter((f) => f.level === "INFO");

if (asJson) {
  console.log(JSON.stringify({ ok: errors.length === 0, errors: errors.length, warnings: warns.length, findings }, null, 2));
} else if (findings.length === 0) {
  console.log("[check] clean — no data integrity findings");
} else {
  for (const group of [errors, warns, infos]) {
    for (const f of group) {
      console.log(`${f.level.padEnd(5)} ${f.code.padEnd(28)} ${f.message}`);
      if (f.detail) console.log(`      ${JSON.stringify(f.detail)}`);
    }
  }
  console.log(`\n[check] ${errors.length} error(s), ${warns.length} warning(s), ${infos.length} info`);
}

process.exit(errors.length ? 1 : 0);
