import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const REMOVED_SETTING_KEYS = [
  "mitmEnabled",
  "mitmRouterBaseUrl",
  "mitmCertInstalled",
  "mitmSudoEncrypted",
  "dnsToolEnabled",
  "headroomEnabled",
  "headroomUrl",
  "headroomCompressUserMessages",
  "headroomCodeAware",
  "headroomKompress",
  "activeRoutingProfile",
  "routingProfiles",
  "password",
  "authMode",
  "oidcIssuerUrl",
  "oidcClientId",
  "oidcClientSecret",
  "oidcScopes",
  "oidcLoginLabel",
];
const REMOVED_PROVIDER_STRATEGY_KEYS = new Set([
  "alicode",
  "codebuddy-cn",
  "glm-cn",
  "iflow",
  "minimax-cn",
  "volcengine-ark",
]);
const VALID_CAVEMAN_LEVELS = new Set(["lite", "full", "ultra"]);

const DEFAULT_SETTINGS = {
  stickyRoundRobinLimit: 3,
  providerStrategies: {},
  quotaVisibility: {},
  comboStrategy: "fallback",
  comboStickyRoundRobinLimit: 1,
  comboStrategies: {},
  requireLogin: false,
  enableObservability: true,
  observabilityMaxRecords: 1000,
  observabilityBatchSize: 20,
  observabilityFlushIntervalMs: 5000,
  observabilityMaxJsonSize: 5,
  outboundProxyEnabled: false,
  outboundProxyUrl: "",
  outboundNoProxy: "",
  rtkEnabled: true,
  cavemanEnabled: false,
  cavemanLevel: "full",
  ponytailEnabled: false,
  ponytailLevel: "full",
  pxpipeEnabled: false,
  pxpipeAutoInstall: true,
  pxpipeMinChars: 25000,
  pxpipeTimeoutMs: 15000,
};

async function readRaw() {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM settings WHERE id = 1`);
  return row ? parseJson(row.data, {}) : {};
}

function withoutRemovedSettings(raw) {
  const cleaned = { ...(raw || {}) };
  for (const key of REMOVED_SETTING_KEYS) delete cleaned[key];
  if (cleaned.providerStrategies && typeof cleaned.providerStrategies === "object") {
    cleaned.providerStrategies = Object.fromEntries(
      Object.entries(cleaned.providerStrategies)
        .filter(([provider]) => !REMOVED_PROVIDER_STRATEGY_KEYS.has(provider))
    );
  }
  return cleaned;
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), min), max);
}

function sanitizeSettingValues(raw) {
  const cleaned = withoutRemovedSettings(raw);
  // Dashboard authentication is intentionally disabled for this local build.
  cleaned.requireLogin = false;
  if (cleaned.cavemanLevel !== undefined && !VALID_CAVEMAN_LEVELS.has(cleaned.cavemanLevel)) {
    cleaned.cavemanLevel = DEFAULT_SETTINGS.cavemanLevel;
  }
  // Observability knobs are easy to set too high from older builds / hand edits.
  // Keep them inside safe ranges so requestDetails cannot balloon again.
  if (cleaned.observabilityMaxRecords !== undefined) {
    cleaned.observabilityMaxRecords = clampInt(
      cleaned.observabilityMaxRecords,
      DEFAULT_SETTINGS.observabilityMaxRecords,
      50,
      2000,
    );
  }
  if (cleaned.observabilityBatchSize !== undefined) {
    cleaned.observabilityBatchSize = clampInt(
      cleaned.observabilityBatchSize,
      DEFAULT_SETTINGS.observabilityBatchSize,
      1,
      200,
    );
  }
  if (cleaned.observabilityFlushIntervalMs !== undefined) {
    cleaned.observabilityFlushIntervalMs = clampInt(
      cleaned.observabilityFlushIntervalMs,
      DEFAULT_SETTINGS.observabilityFlushIntervalMs,
      500,
      60000,
    );
  }
  // Stored unit is KB per JSON field. Cap at 64 KB — historical values like
  // 1024 produced 1 MB/field rows and froze the gateway under usage stats.
  if (cleaned.observabilityMaxJsonSize !== undefined) {
    cleaned.observabilityMaxJsonSize = clampInt(
      cleaned.observabilityMaxJsonSize,
      DEFAULT_SETTINGS.observabilityMaxJsonSize,
      1,
      64,
    );
  }
  return cleaned;
}

// Merge raw settings with defaults; backward-compat for missing keys
function mergeWithDefaults(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...sanitizeSettingValues(raw) };
  for (const [key, defVal] of Object.entries(DEFAULT_SETTINGS)) {
    if (merged[key] === undefined) {
      if (
        key === "outboundProxyEnabled" &&
        typeof merged.outboundProxyUrl === "string" &&
        merged.outboundProxyUrl.trim()
      ) {
        merged[key] = true;
      } else {
        merged[key] = defVal;
      }
    }
  }
  return merged;
}

// Hot-path cache: chat/auth call getSettings() multiple times per request.
// Invalidate on every write so dashboard updates stay immediately visible.
// Survive Next.js dev HMR via global (same pattern as db/driver.js).
if (!global._settingsCache) global._settingsCache = { value: null, inflight: null };
const settingsCache = global._settingsCache;

export function invalidateSettingsCache() {
  settingsCache.value = null;
  settingsCache.inflight = null;
}

export async function getSettings() {
  if (settingsCache.value) return settingsCache.value;
  if (settingsCache.inflight) return settingsCache.inflight;
  settingsCache.inflight = readRaw()
    .then((raw) => {
      const merged = mergeWithDefaults(raw);
      settingsCache.value = merged;
      settingsCache.inflight = null;
      return merged;
    })
    .catch((err) => {
      settingsCache.inflight = null;
      throw err;
    });
  return settingsCache.inflight;
}

// Atomic read-merge-write inside transaction (prevents losing concurrent updates)
export async function updateSettings(updates) {
  const db = await getAdapter();
  let next;
  db.transaction(() => {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    const current = sanitizeSettingValues(row ? parseJson(row.data, {}) : {});
    next = sanitizeSettingValues({ ...current, ...withoutRemovedSettings(updates) });
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(next)]
    );
  });
  const merged = mergeWithDefaults(next);
  // Publish immediately so concurrent readers see the write without a stale hit.
  settingsCache.value = merged;
  settingsCache.inflight = null;
  return merged;
}

export async function exportSettings() {
  return sanitizeSettingValues(await readRaw());
}
