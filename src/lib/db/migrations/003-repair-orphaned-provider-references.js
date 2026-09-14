// Data repair: drop references to provider-nodes that no longer exist, prune
// stale settings maps, and redact plaintext gateway keys from usage records.
//
// WHY this data exists: DELETE /api/provider-nodes/[id] removed the node and its
// connections but never cleaned kv.customModels / kv.modelAliases / the settings
// maps keyed by that node id (see src/app/api/provider-nodes/[id]/route.js).
// Every node the user ever deleted left rows behind permanently.
//
// SAFETY — this migration deletes rows, so:
//  1. migrate.js already took a backupDbLite() before calling us (SCHEMA_VERSION
//     bumped to 3), and
//  2. we ALSO write a human-readable recovery dump of everything removed to
//     <DB_DIR>/backups/repair-003-<timestamp>.json before deleting.
//
// SCOPE — we only drop references whose provider id is a *generated* dynamic
// compat id (`openai-compatible-chat-<uuid>`, `anthropic-compatible-<uuid>`,
// `custom-embedding-<uuid>`) with no matching providerNodes row. Those ids can
// never come back: they are minted by generateId() at node-creation time.
// Short user-chosen prefixes (`oc/`, `kr/`, `gh/`…) are LEFT ALONE — the user can
// recreate a node with the same prefix and those references start working again.
import fs from "node:fs";
import path from "node:path";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { fingerprintApiKey, isFingerprinted } from "../helpers/apiKeyPrivacy.js";
import { BACKUPS_DIR, ensureDirs } from "../paths.js";

// Kept local (not imported from @/shared/constants/providers) so this migration
// stays free of the REGISTRY import chain.
const DYNAMIC_PROVIDER_PREFIXES = [
  "openai-compatible-chat-",
  "openai-compatible-responses-",
  "anthropic-compatible-",
  "custom-embedding-",
];

function isDynamicProviderId(id) {
  return typeof id === "string" && DYNAMIC_PROVIDER_PREFIXES.some((p) => id.startsWith(p));
}

// Redaction of already-persisted keys uses the shared helper in
// helpers/apiKeyPrivacy.js so the value produced here is byte-identical to what
// the live write path stores. A local copy would drift and split one key's
// stats across two buckets.

function writeRecoveryDump(payload) {
  try {
    ensureDirs();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(BACKUPS_DIR, `repair-003-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf-8");
    return file;
  } catch (e) {
    console.warn(`[DB][migrate:003] recovery dump failed (continuing): ${e.message}`);
    return null;
  }
}

export default {
  version: 3,
  name: "repair-orphaned-provider-references",
  up(db) {
    const liveNodeIds = new Set(db.all(`SELECT id FROM providerNodes`).map((r) => r.id));
    const comboNames = new Set(db.all(`SELECT name FROM combos`).map((r) => r.name));
    const connectionIds = new Set(db.all(`SELECT id FROM providerConnections`).map((r) => r.id));

    // A reference is dead only if it points at a generated node id that is gone.
    const isDeadProviderId = (id) => isDynamicProviderId(id) && !liveNodeIds.has(id);

    const removed = {
      _note: "Rows removed by migration 003. To restore, re-create the provider node with the recorded id, then re-add these entries.",
      migratedAt: new Date().toISOString(),
      customModels: [],
      modelAliases: [],
      providerStrategies: {},
      comboStrategies: {},
      codexAutoPingConnections: {},
      prunedModelLocks: 0,
      prunedModelLockConnections: 0,
      clearedStaleErrorCodes: 0,
      redactedUsageApiKeys: 0,
    };

    // ── 1. kv.customModels — key is `${providerAlias}|${id}|${type}` ────────
    for (const row of db.all(`SELECT key, value FROM kv WHERE scope = 'customModels'`)) {
      const model = parseJson(row.value, null);
      // Trust the stored providerAlias; fall back to the key prefix if unparseable.
      const alias = model?.providerAlias ?? String(row.key).split("|")[0];
      if (!isDeadProviderId(alias)) continue;
      removed.customModels.push({ key: row.key, value: model ?? row.value });
      db.run(`DELETE FROM kv WHERE scope = 'customModels' AND key = ?`, [row.key]);
    }

    // ── 2. kv.modelAliases — value is `${provider}/${model}` ───────────────
    for (const row of db.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases'`)) {
      const target = parseJson(row.value, row.value);
      if (typeof target !== "string") continue;
      const provider = target.split("/")[0];
      if (!isDeadProviderId(provider)) continue;
      removed.modelAliases.push({ alias: row.key, target });
      db.run(`DELETE FROM kv WHERE scope = 'modelAliases' AND key = ?`, [row.key]);
    }

    // ── 3. settings maps ───────────────────────────────────────────────────
    const settingsRow = db.get(`SELECT data FROM settings WHERE id = 1`);
    if (settingsRow) {
      const settings = parseJson(settingsRow.data, {});
      if (settings && typeof settings === "object" && !Array.isArray(settings)) {
        let dirty = false;

        // 3a. providerStrategies keyed by a deleted node id.
        if (settings.providerStrategies && typeof settings.providerStrategies === "object") {
          for (const [provider, value] of Object.entries(settings.providerStrategies)) {
            if (!isDeadProviderId(provider)) continue;
            removed.providerStrategies[provider] = value;
            delete settings.providerStrategies[provider];
            dirty = true;
          }
        }

        // 3b. comboStrategies whose combo no longer exists. Lookup in
        // src/sse/handlers/chat.js is exact-match on combo name, so a key that
        // matches no combos row can never be read.
        if (settings.comboStrategies && typeof settings.comboStrategies === "object") {
          for (const [name, value] of Object.entries(settings.comboStrategies)) {
            if (comboNames.has(name)) continue;
            removed.comboStrategies[name] = value;
            delete settings.comboStrategies[name];
            dirty = true;
          }
        }

        // 3c. codexAutoPing entries for connections that were deleted.
        const ping = settings.codexAutoPing;
        if (ping && typeof ping === "object" && ping.connections && typeof ping.connections === "object") {
          for (const [connId, value] of Object.entries(ping.connections)) {
            if (connectionIds.has(connId)) continue;
            removed.codexAutoPingConnections[connId] = value;
            delete ping.connections[connId];
            dirty = true;
          }
        }

        if (dirty) {
          db.run(`UPDATE settings SET data = ? WHERE id = 1`, [stringifyJson(settings)]);
        }
      }
    }

    // ── 4. Prune dead per-model backoff locks on connections ───────────────
    // `modelLock_${model}` keys are written flat onto the connection by
    // src/sse/services/auth.js. clearAccountError() nulls an expired lock but
    // never removes the key, and the model name space is caller-controlled, so
    // these accumulate without bound. connToRow() now prunes on every write —
    // this sweeps the backlog that predates that fix. Active locks are kept.
    const nowMs = Date.now();
    let prunedLocks = 0;
    let prunedConns = 0;
    let clearedErrorCodes = 0;
    for (const row of db.all(`SELECT id, provider, data FROM providerConnections`)) {
      const data = parseJson(row.data, null);
      if (!data || typeof data !== "object" || Array.isArray(data)) continue;

      let changed = 0;
      let lockChanges = 0;
      for (const key of Object.keys(data)) {
        if (!key.startsWith("modelLock_")) continue;
        const expiry = data[key];
        if (expiry === null || expiry === undefined || expiry === "") {
          delete data[key];
          changed++;
          lockChanges++;
          continue;
        }
        const ts = new Date(expiry).getTime();
        if (!Number.isFinite(ts) || ts <= nowMs) {
          delete data[key];
          changed++;
          lockChanges++;
        }
      }

      // Stale errorCode on an otherwise-healthy account. clearAccountError()
      // in src/sse/services/auth.js now nulls errorCode, but it RETURNS EARLY
      // when there is nothing to clear (`keysToClear.length === 0 &&
      // testStatus !== "unavailable" && !lastError`) — which is exactly the
      // state these rows are in, so the runtime can never reach them. Only a
      // sweep here can fix the backlog. Rows still marked "unavailable" or
      // holding a lastError are left alone: their errorCode is real diagnostics.
      const healthy = data.testStatus === "active" && data.lastError == null;
      if (data.errorCode != null && healthy) {
        delete data.errorCode;
        clearedErrorCodes++;
        changed++;
      }

      if (changed > 0) {
        db.run(`UPDATE providerConnections SET data = ? WHERE id = ?`, [stringifyJson(data), row.id]);
        prunedLocks += lockChanges;
        prunedConns++;
      }
    }
    removed.prunedModelLocks = prunedLocks;
    removed.prunedModelLockConnections = prunedConns;
    removed.clearedStaleErrorCodes = clearedErrorCodes;

    // ── 5. Redact plaintext gateway keys already persisted in usage records ──
    // The write path itself still stores them unmasked (src/lib/db/repos/
    // usageRepo.js) — that is a separate fix. This only shrinks existing exposure.
    for (const row of db.all(`SELECT id, apiKey FROM usageHistory WHERE apiKey IS NOT NULL AND apiKey <> ''`)) {
      if (isFingerprinted(row.apiKey)) continue;
      db.run(`UPDATE usageHistory SET apiKey = ? WHERE id = ?`, [fingerprintApiKey(row.apiKey), row.id]);
      removed.redactedUsageApiKeys++;
    }

    // usageDaily.byApiKey stores the raw key twice: inside the composite bucket
    // key (`${apiKey}|${model}|${provider}`) and again in meta.apiKey.
    for (const row of db.all(`SELECT dateKey, data FROM usageDaily`)) {
      const day = parseJson(row.data, null);
      if (!day || typeof day !== "object" || !day.byApiKey || typeof day.byApiKey !== "object") continue;

      let dayDirty = false;
      const rebuilt = {};
      for (const [bucketKey, bucket] of Object.entries(day.byApiKey)) {
        const parts = String(bucketKey).split("|");
        const rawKey = parts[0];
        let nextKey = bucketKey;

        if (rawKey && rawKey !== "local-no-key" && !isFingerprinted(rawKey)) {
          parts[0] = fingerprintApiKey(rawKey);
          nextKey = parts.join("|");
          dayDirty = true;
        }
        // addToCounter() spreads `meta` FLAT onto the bucket via Object.assign
        // (src/lib/db/repos/usageRepo.js), so the second copy of the key lives
        // at `bucket.apiKey` — NOT at `bucket.meta.apiKey`. getUsageStats reads
        // it back as `ak.apiKey`. Handle the nested shape too in case an older
        // build wrote one.
        if (bucket?.apiKey && !isFingerprinted(bucket.apiKey)) {
          bucket.apiKey = fingerprintApiKey(bucket.apiKey);
          dayDirty = true;
        }
        if (bucket?.meta?.apiKey && !isFingerprinted(bucket.meta.apiKey)) {
          bucket.meta.apiKey = fingerprintApiKey(bucket.meta.apiKey);
          dayDirty = true;
        }

        // Masking can collapse two buckets onto one key — merge their counters
        // instead of letting the later one overwrite the earlier.
        const existing = rebuilt[nextKey];
        if (existing) {
          for (const field of ["requests", "promptTokens", "completionTokens", "cachedTokens", "cost"]) {
            existing[field] = (existing[field] || 0) + (bucket?.[field] || 0);
          }
        } else {
          rebuilt[nextKey] = bucket;
        }
      }

      if (dayDirty) {
        day.byApiKey = rebuilt;
        db.run(`UPDATE usageDaily SET data = ? WHERE dateKey = ?`, [stringifyJson(day), row.dateKey]);
      }
    }

    // ── 6. Report + recovery dump ──────────────────────────────────────────
    const touched =
      removed.customModels.length +
      removed.modelAliases.length +
      Object.keys(removed.providerStrategies).length +
      Object.keys(removed.comboStrategies).length +
      Object.keys(removed.codexAutoPingConnections).length +
      removed.prunedModelLocks +
      removed.clearedStaleErrorCodes +
      removed.redactedUsageApiKeys;

    if (touched === 0) {
      console.log("[DB][migrate:003] nothing to repair");
      return;
    }

    const dumpFile = writeRecoveryDump(removed);
    console.log(
      `[DB][migrate:003] repaired: ${removed.customModels.length} customModels, ` +
      `${removed.modelAliases.length} modelAliases, ` +
      `${Object.keys(removed.providerStrategies).length} providerStrategies, ` +
      `${Object.keys(removed.comboStrategies).length} comboStrategies, ` +
      `${Object.keys(removed.codexAutoPingConnections).length} codexAutoPing entries, ` +
      `${removed.prunedModelLocks} dead modelLocks on ${removed.prunedModelLockConnections} connections, ` +
      `${removed.clearedStaleErrorCodes} stale errorCodes, ` +
      `${removed.redactedUsageApiKeys} usage apiKeys redacted` +
      (dumpFile ? ` | recovery dump: ${dumpFile}` : " | recovery dump UNAVAILABLE")
    );
  },
};
