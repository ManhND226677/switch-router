// Public API barrel — all DB functions
import { getAdapter } from "./driver.js";
import { stringifyJson, parseJson } from "./helpers/jsonCol.js";
import { invalidateSettingsCache } from "./repos/settingsRepo.js";
import { invalidateConnectionsCache } from "./repos/connectionsRepo.js";
import { invalidateProviderNodesCache } from "./repos/nodesRepo.js";
import { invalidateCombosCache } from "./repos/combosRepo.js";
import { invalidateModelAliasesCache } from "./repos/aliasRepo.js";
import { invalidateProxyPoolsCache } from "./repos/proxyPoolsRepo.js";
import { invalidateApiKeysCache } from "./repos/apiKeysRepo.js";

// Settings
export {
  getSettings, updateSettings, exportSettings,
} from "./repos/settingsRepo.js";

// Provider connections
export {
  getProviderConnections, getProviderConnectionById,
  createProviderConnection, updateProviderConnection, updateProviderConnectionsBatch,
  deleteProviderConnection, cleanupProviderConnections,
} from "./repos/connectionsRepo.js";

// Provider nodes
export {
  getProviderNodes, getProviderNodeById,
  createProviderNode, updateProviderNode, deleteProviderNode,
} from "./repos/nodesRepo.js";

// Proxy pools
export {
  getProxyPools, getProxyPoolById,
  createProxyPool, updateProxyPool, deleteProxyPool,
} from "./repos/proxyPoolsRepo.js";

// API keys
export {
  getApiKeys, getApiKeyById, getApiKeyByKey, createApiKey, updateApiKey, deleteApiKey,
  validateApiKey, getKeyMonthlySpendUsd, getKeySpendMapUsd,
} from "./repos/apiKeysRepo.js";

// Combos
export {
  getCombos, getComboById, getComboByName,
  createCombo, updateCombo, deleteCombo,
} from "./repos/combosRepo.js";

// Aliases (model + custom)
export {
  getModelAliases, setModelAlias, deleteModelAlias,
  getCustomModels, addCustomModel, deleteCustomModel,
} from "./repos/aliasRepo.js";

// Pricing
export {
  getPricing, getPricingForModel, updatePricing, resetPricing, resetAllPricing,
} from "./repos/pricingRepo.js";

// Disabled models
export {
  getDisabledModels, getDisabledByProvider, disableModels, enableModels,
} from "./repos/disabledModelsRepo.js";

// Usage
export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  saveRequestUsage, flushPendingUsage, getUsageHistory, getUsageHistoryPage, getUsageStats, getChartData,
  invalidateUsageStatsCache, getUsageStatsVersion, appendRequestLog, getLatestUsageId,
  getRecentLogs, getRecentLogsPage, getProviderSpendWindows, getCacheStats,
} from "./repos/usageRepo.js";

// Request details
export {
  saveRequestDetail, getRequestDetails, getRequestDetailById, getDistinctProviders,
  compactRequestDetails, getErrorAnalytics,
} from "./repos/requestDetailsRepo.js";

// Export/import full DB
//
// Secrets are NEVER written to the export payload raw (README promises "raw
// keys are never exported"). exportDb replaces each secret with a
// sentinel string; importDb restores sentinel values from the live DB rows
// BEFORE wiping the tables, so a backup round-trip keeps working credentials
// while the backup file itself only ever contains the sentinels. Any sentinel
// that has no matching live row is dropped, not kept.
export const SECRET_SENTINEL = "__switch-router__masked__";

const CONNECTION_SECRET_FIELDS = [
  "accessToken", "refreshToken", "idToken", "apiKey",
];

// PII shown in the dashboard (UI review finding): masked in exports so a
// backup file does not carry the user's account emails in plaintext.
const CONNECTION_PII_FIELDS = ["email", "displayName"];

function maskConnectionSecrets(conn) {
  const masked = { ...conn };
  for (const field of CONNECTION_SECRET_FIELDS) {
    if (masked[field]) masked[field] = SECRET_SENTINEL;
  }
  for (const field of CONNECTION_PII_FIELDS) {
    if (typeof masked[field] === "string" && masked[field]) {
      masked[field] = SECRET_SENTINEL;
    }
  }
  return masked;
}

// Build lookup tables from the CURRENT live DB so importDb can restore the
// real secrets a masked payload refers to.
function buildSecretRestoreMaps(db) {
  const connMap = new Map();
  for (const r of db.all(`SELECT id, data, email FROM providerConnections`)) {
    const data = parseJson(r.data, {});
    const secrets = {};
    for (const field of CONNECTION_SECRET_FIELDS) {
      if (data[field]) secrets[field] = data[field];
    }
    if (r.email) secrets.email = r.email;
    if (data.displayName) secrets.displayName = data.displayName;
    connMap.set(r.id, secrets);
  }
  const keyMap = new Map();
  for (const r of db.all(`SELECT id, key FROM apiKeys`)) {
    keyMap.set(r.id, r.key);
  }
  const proxyPoolUrlMap = new Map();
  for (const r of db.all(`SELECT id, data FROM proxyPools`)) {
    const data = parseJson(r.data, {});
    if (data.proxyUrl) proxyPoolUrlMap.set(r.id, data.proxyUrl);
  }
  return { connMap, keyMap, proxyPoolUrlMap };
}

// Proxy pools store credentials inline in proxyUrl (user:pass@host). Mask the
// userinfo while keeping the host:port visible so the backup stays readable.
function maskProxyPoolCredentials(pool) {
  const masked = { ...pool };
  if (typeof masked.proxyUrl === "string" && masked.proxyUrl) {
    try {
      const u = new URL(masked.proxyUrl);
      if (u.username || u.password) {
        u.username = u.username ? SECRET_SENTINEL : "";
        u.password = u.password ? SECRET_SENTINEL : "";
        masked.proxyUrl = u.toString();
      }
    } catch { /* not a parseable URL — leave as-is */ }
  }
  return masked;
}

export async function exportDb() {
  const db = await getAdapter();
  const { exportSettings } = await import("./repos/settingsRepo.js");

  const out = {
    settings: await exportSettings(),
    providerConnections: db.all(`SELECT * FROM providerConnections`).map((r) => maskConnectionSecrets({ ...parseJson(r.data, {}), id: r.id, provider: r.provider, authType: r.authType, name: r.name, email: r.email, priority: r.priority, isActive: r.isActive === 1, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    providerNodes: db.all(`SELECT * FROM providerNodes`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, type: r.type, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    proxyPools: db.all(`SELECT * FROM proxyPools`).map((r) => maskProxyPoolCredentials({ ...parseJson(r.data, {}), id: r.id, isActive: r.isActive === 1, testStatus: r.testStatus, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    apiKeys: db.all(`SELECT * FROM apiKeys`).map((r) => ({ id: r.id, key: `${r.key.slice(0, 8)}${SECRET_SENTINEL}`, name: r.name, machineId: r.machineId, isActive: r.isActive === 1, createdAt: r.createdAt, allowedModels: parseJson(r.allowedModels, []) || [], monthlyBudgetUsd: r.monthlyBudgetUsd ?? null, rateLimitRpm: r.rateLimitRpm ?? null, expiresAt: r.expiresAt ?? null, lastUsedAt: r.lastUsedAt ?? null })),
    combos: db.all(`SELECT * FROM combos`).map((r) => ({ id: r.id, name: r.name, kind: r.kind, models: parseJson(r.models, []), createdAt: r.createdAt, updatedAt: r.updatedAt })),
    modelAliases: {},
    customModels: [],
    pricing: {},
  };

  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases'`)) out.modelAliases[r.key] = parseJson(r.value);
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'customModels'`)) out.customModels.push(parseJson(r.value));
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'pricing'`)) out.pricing[r.key] = parseJson(r.value);

  return out;
}

export async function importDb(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }
  const db = await getAdapter();

  // Read the live secrets BEFORE the wipe below so masked backup payloads
  // can be restored against the credentials currently on this machine.
  const { connMap, keyMap, proxyPoolUrlMap } = buildSecretRestoreMaps(db);

  db.transaction(() => {
    // Wipe all tables (keep _meta)
    db.run(`DELETE FROM settings`);
    db.run(`DELETE FROM providerConnections`);
    db.run(`DELETE FROM providerNodes`);
    db.run(`DELETE FROM proxyPools`);
    db.run(`DELETE FROM apiKeys`);
    db.run(`DELETE FROM combos`);
    db.run(`DELETE FROM kv WHERE scope IN ('modelAliases', 'customModels', 'mitmAlias', 'pricing')`);

    // Settings
    if (payload.settings) {
      const settings = { ...payload.settings };
      delete settings.activeRoutingProfile;
      delete settings.routingProfiles;
      db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson(settings)]);
    }

    for (const c of payload.providerConnections || []) {
      const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
      // Restore secrets masked by exportDb: a sentinel takes the value of the
      // live row with the same id; a sentinel with no live counterpart is
      // dropped so a foreign backup cannot inject placeholder credentials.
      const live = connMap.get(id) || {};
      for (const field of CONNECTION_SECRET_FIELDS) {
        if (rest[field] === SECRET_SENTINEL) {
          if (live[field]) rest[field] = live[field];
          else delete rest[field];
        }
      }
      for (const field of CONNECTION_PII_FIELDS) {
        if (rest[field] === SECRET_SENTINEL) {
          if (live[field]) rest[field] = live[field];
          else delete rest[field];
        }
      }
      // email lives in its own column: a masked sentinel restores from the live
      // row, or becomes null when there is no live counterpart.
      let restoredEmail = typeof email === "string" ? email : (email ?? null);
      if (restoredEmail === SECRET_SENTINEL) restoredEmail = live.email || null;
      db.run(
        `INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, provider, authType || "oauth", name || null, restoredEmail, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const n of payload.providerNodes || []) {
      const { id, type, name, createdAt, updatedAt, ...rest } = n;
      db.run(
        `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const p of payload.proxyPools || []) {
      const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
      // Restore masked proxy credentials from the live pool with the same id;
      // a sentinel with no live counterpart is stripped so the restored URL
      // carries host:port only (the pool simply has no credentials then).
      if (typeof rest.proxyUrl === "string" && rest.proxyUrl) {
        try {
          const u = new URL(rest.proxyUrl);
          if (u.username === SECRET_SENTINEL || u.password === SECRET_SENTINEL) {
            const liveUrl = proxyPoolUrlMap.get(id);
            const live = liveUrl ? new URL(liveUrl) : null;
            if (u.username === SECRET_SENTINEL) u.username = live?.username || "";
            if (u.password === SECRET_SENTINEL) u.password = live?.password || "";
            if (u.username === SECRET_SENTINEL) u.username = "";
            if (u.password === SECRET_SENTINEL) u.password = "";
            rest.proxyUrl = u.toString();
          }
        } catch { /* not a parseable URL — keep as-is */ }
      }
      db.run(
        `INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const k of payload.apiKeys || []) {
      // Restore the raw key hidden behind the export mask. A mask with no live
      // counterpart cannot be validated anyway — such keys are skipped.
      let rawKey = k.key;
      if (typeof rawKey === "string" && rawKey.includes(SECRET_SENTINEL)) {
        rawKey = keyMap.get(k.id) || null;
        if (!rawKey) continue;
      }
      db.run(
        `INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, isActive, createdAt, allowedModels, monthlyBudgetUsd, rateLimitRpm, expiresAt, lastUsedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [k.id, rawKey, k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, k.createdAt || new Date().toISOString(), stringifyJson(Array.isArray(k.allowedModels) ? k.allowedModels : []), k.monthlyBudgetUsd ?? null, k.rateLimitRpm ?? null, k.expiresAt ?? null, k.lastUsedAt ?? null]
      );
    }
    for (const c of payload.combos || []) {
      db.run(
        `INSERT OR REPLACE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
      );
    }
    for (const [a, m] of Object.entries(payload.modelAliases || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('modelAliases', ?, ?)`, [a, stringifyJson(m)]);
    }
    for (const m of payload.customModels || []) {
      const k = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, stringifyJson(m)]);
    }
    for (const [provider, models] of Object.entries(payload.pricing || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('pricing', ?, ?)`, [provider, stringifyJson(models || {})]);
    }
  });

  // importDb writes via raw SQL — drop every hot-path cache.
  invalidateSettingsCache();
  invalidateConnectionsCache();
  invalidateProviderNodesCache();
  invalidateCombosCache();
  invalidateModelAliasesCache();
  invalidateProxyPoolsCache();
  invalidateApiKeysCache();

  return await exportDb();
}

// Eager init helper (optional)
export async function initDb() {
  await getAdapter();
}
