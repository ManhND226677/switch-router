import { EventEmitter } from "events";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { fingerprintApiKey, isFingerprinted } from "../helpers/apiKeyPrivacy.js";
import { getMeta, setMeta } from "../helpers/metaStore.js";
import { toValidDateIso } from "./dateFilter.js";
import { STREAM_MAX_DURATION_MS } from "open-sse/config/runtimeConfig.js";

function maskApiKey(key) {
  if (!key || typeof key !== "string") return null;
  // Already fingerprinted (see helpers/apiKeyPrivacy.js) — masking twice would
  // throw away the trailing entropy and re-collapse distinct keys into one
  // bucket.
  if (isFingerprinted(key)) return key;
  if (key.length <= 8) return key.charAt(0) + "***";
  return key.slice(0, 8) + "***";
}

// Safety net that force-zeroes the pending counters if the "done" signal never
// arrives. Must outlive the longest possible stream: a stream running up to
// STREAM_MAX_DURATION_MS would otherwise be shown as finished while still
// streaming. Keep a 60s grace beyond the max stream duration.
const PENDING_TIMEOUT_MS = STREAM_MAX_DURATION_MS + 60 * 1000;
const RING_CAP = 50;
const CONN_CACHE_TTL_MS = 30 * 1000;
const PERIOD_MS = { "24h": 86400000, "7d": 604800000, "30d": 2592000000, "60d": 5184000000 };
const USAGE_STATS_CACHE_TTL_MS = 2500;
const USAGE_CHART_CACHE_TTL_MS = 2500;
const USAGE_DAILY_LAST_USED_VERSION = "1";
const USAGE_REFERENCE_CACHE_TTL_MS = 30 * 1000;

// In-memory state shared across Next.js modules
if (!global._pendingRequests) global._pendingRequests = { byModel: {}, byAccount: {} };
if (!global._lastErrorProvider) global._lastErrorProvider = { provider: "", ts: 0 };
if (!global._statsEmitter) {
  global._statsEmitter = new EventEmitter();
  global._statsEmitter.setMaxListeners(50);
}
if (!global._pendingTimers) global._pendingTimers = {};
if (!global._recentRing) global._recentRing = { items: [], initialized: false };
if (!global._connectionMapCache) global._connectionMapCache = { map: {}, ts: 0 };
if (!global._statsEmitTimers) global._statsEmitTimers = { pending: null, update: null };
if (!global._usageStatsCache) global._usageStatsCache = { version: 0, entries: new Map() };
if (!global._usageChartCache) global._usageChartCache = { version: 0, entries: new Map() };
if (!global._usageDailyLastUsedState) global._usageDailyLastUsedState = { adapter: null, ready: false, promise: null };
if (!global._latestUsageIdState) global._latestUsageIdState = { adapter: null, value: null };
if (!global._usageReferenceCache) global._usageReferenceCache = { adapter: null, value: null, updatedAt: 0, promise: null };

const pendingRequests = global._pendingRequests;
const lastErrorProvider = global._lastErrorProvider;
const pendingTimers = global._pendingTimers;
const recentRing = global._recentRing;
const connCache = global._connectionMapCache;
const statsEmitTimers = global._statsEmitTimers;
const statsCache = global._usageStatsCache;
const chartCache = global._usageChartCache;
const dailyLastUsedState = global._usageDailyLastUsedState;
const latestUsageIdState = global._latestUsageIdState;
const referenceCache = global._usageReferenceCache;

export const statsEmitter = global._statsEmitter;

export function invalidateUsageStatsCache() {
  statsCache.version += 1;
  statsCache.entries.clear();
  chartCache.version += 1;
  chartCache.entries.clear();
}

function scheduleStatsEvent(event, delayMs = 150) {
  const key = event === "update" ? "update" : "pending";
  if (statsEmitTimers[key]) return;
  statsEmitTimers[key] = setTimeout(() => {
    statsEmitTimers[key] = null;
    statsEmitter.emit(event);
  }, delayMs);
  statsEmitTimers[key]?.unref?.();
}

function getLocalDateKey(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function maxTimestamp(current, candidate) {
  if (!candidate) return current;
  return String(candidate) > String(current || "") ? candidate : current;
}

function addToCounter(target, key, values) {
  if (!target[key]) target[key] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
  target[key].requests += values.requests || 1;
  target[key].promptTokens += values.promptTokens || 0;
  target[key].completionTokens += values.completionTokens || 0;
  target[key].cachedTokens += values.cachedTokens || 0;
  target[key].cost += values.cost || 0;
  if (values.meta) {
    const lastUsed = values.meta.lastUsed;
    const meta = { ...values.meta };
    delete meta.lastUsed;
    Object.assign(target[key], meta);
    if (lastUsed && String(lastUsed) > String(target[key].lastUsed || "")) {
      target[key].lastUsed = lastUsed;
    }
  }
}

function aggregateEntryToDay(day, entry) {
  const promptTokens = entry.tokens?.prompt_tokens || entry.tokens?.input_tokens || 0;
  const completionTokens = entry.tokens?.completion_tokens || entry.tokens?.output_tokens || 0;
  const cachedTokens = entry.tokens?.cached_tokens || entry.tokens?.cache_read_input_tokens || 0;
  const cost = entry.cost || 0;
  const vals = { promptTokens, completionTokens, cachedTokens, cost };
  const lastUsedMeta = { lastUsed: entry.timestamp };

  day.requests = (day.requests || 0) + 1;
  day.promptTokens = (day.promptTokens || 0) + promptTokens;
  day.completionTokens = (day.completionTokens || 0) + completionTokens;
  day.cachedTokens = (day.cachedTokens || 0) + cachedTokens;
  day.cost = (day.cost || 0) + cost;

  day.byProvider ||= {};
  day.byModel ||= {};
  day.byAccount ||= {};
  day.byApiKey ||= {};
  day.byEndpoint ||= {};

  if (entry.provider) addToCounter(day.byProvider, entry.provider, vals);

  const modelKey = entry.provider ? `${entry.model}|${entry.provider}` : entry.model;
  addToCounter(day.byModel, modelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider, ...lastUsedMeta } });

  if (entry.connectionId) {
    addToCounter(day.byAccount, entry.connectionId, { ...vals, meta: { rawModel: entry.model, provider: entry.provider, ...lastUsedMeta } });
  }

  const apiKeyVal = entry.apiKey && typeof entry.apiKey === "string" ? entry.apiKey : "local-no-key";
  const akModelKey = `${apiKeyVal}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byApiKey, akModelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider, apiKey: entry.apiKey || null, ...lastUsedMeta } });

  const endpoint = entry.endpoint || "Unknown";
  const epKey = `${endpoint}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byEndpoint, epKey, { ...vals, meta: { endpoint, rawModel: entry.model, provider: entry.provider, ...lastUsedMeta } });
}

function pushToRing(entry) {
  recentRing.items.push(entry);
  if (recentRing.items.length > RING_CAP) {
    recentRing.items = recentRing.items.slice(-RING_CAP);
  }
}

async function getConnectionMapCached() {
  if (Date.now() - connCache.ts < CONN_CACHE_TTL_MS) return connCache.map;
  try {
    const { getProviderConnections } = await import("./connectionsRepo.js");
    const all = await getProviderConnections();
    const map = {};
    for (const c of all) map[c.id] = c.name || c.email || c.id;
    connCache.map = map;
    connCache.ts = Date.now();
  } catch {}
  return connCache.map;
}

async function ensureRingInitialized() {
  if (recentRing.initialized) return;
  try {
    const db = await getAdapter();
    const rows = db.all(`SELECT timestamp, provider, model, connectionId, apiKey, endpoint, cost, status, tokens FROM usageHistory ORDER BY id DESC LIMIT ?`, [RING_CAP]);
    const backfilled = rows.reverse().map((r) => ({
      timestamp: r.timestamp, provider: r.provider, model: r.model, connectionId: r.connectionId,
      apiKey: r.apiKey, endpoint: r.endpoint, cost: r.cost, status: r.status,
      tokens: parseJson(r.tokens, {}),
    }));
    // Live entries pushed while the DB was unavailable are newer than any
    // historical row — keep them, backfill only the older tail. Marking
    // initialized only on success lets a transient DB failure retry later.
    recentRing.items = [...backfilled, ...recentRing.items].slice(-RING_CAP);
    recentRing.initialized = true;
  } catch {}
}

function updateCounterLastUsed(target, key, timestamp) {
  const counter = target?.[key];
  if (!counter || !timestamp) return;
  if (String(timestamp) > String(counter.lastUsed || "")) counter.lastUsed = timestamp;
}

function updateDailyLastUsed(day, entry) {
  const timestamp = entry.timestamp;
  if (!day || !timestamp) return;

  const modelKey = entry.provider ? `${entry.model}|${entry.provider}` : entry.model;
  updateCounterLastUsed(day.byModel, modelKey, timestamp);

  if (entry.connectionId) updateCounterLastUsed(day.byAccount, entry.connectionId, timestamp);

  const apiKeyVal = entry.apiKey && typeof entry.apiKey === "string" ? entry.apiKey : "local-no-key";
  const apiKeyKey = `${apiKeyVal}|${entry.model}|${entry.provider || "unknown"}`;
  updateCounterLastUsed(day.byApiKey, apiKeyKey, timestamp);

  const endpoint = entry.endpoint || "Unknown";
  const endpointKey = `${endpoint}|${entry.model}|${entry.provider || "unknown"}`;
  updateCounterLastUsed(day.byEndpoint, endpointKey, timestamp);
}

async function ensureDailyLastUsed(db) {
  if (dailyLastUsedState.adapter !== db) {
    dailyLastUsedState.adapter = db;
    dailyLastUsedState.ready = false;
    dailyLastUsedState.promise = null;
  }
  if (dailyLastUsedState.ready) return true;
  if (dailyLastUsedState.promise) return dailyLastUsedState.promise;

  dailyLastUsedState.promise = Promise.resolve().then(() => {
    const marker = db.get(`SELECT value FROM _meta WHERE key = 'usageDailyLastUsedVersion'`);
    if (marker?.value === USAGE_DAILY_LAST_USED_VERSION) {
      dailyLastUsedState.ready = true;
      return true;
    }

    const dailyRows = db.all(`SELECT dateKey, data FROM usageDaily`);
    const dayMap = new Map();
    for (const row of dailyRows) dayMap.set(row.dateKey, parseJson(row.data, {}));

    if (dayMap.size > 0) {
      const historyRows = db.all(
        `SELECT timestamp, provider, model, connectionId, apiKey, endpoint FROM usageHistory ORDER BY id ASC`,
      );
      for (const row of historyRows) {
        const dateKey = getLocalDateKey(row.timestamp);
        const day = dayMap.get(dateKey);
        if (day) updateDailyLastUsed(day, row);
      }

      db.transaction(() => {
        for (const [dateKey, day] of dayMap) {
          db.run(`UPDATE usageDaily SET data = ? WHERE dateKey = ?`, [stringifyJson(day), dateKey]);
        }
        db.run(
          `INSERT INTO _meta(key, value) VALUES('usageDailyLastUsedVersion', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          [USAGE_DAILY_LAST_USED_VERSION],
        );
      });
    } else {
      db.run(
        `INSERT INTO _meta(key, value) VALUES('usageDailyLastUsedVersion', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [USAGE_DAILY_LAST_USED_VERSION],
      );
    }

    dailyLastUsedState.ready = true;
    return true;
  }).catch((error) => {
    dailyLastUsedState.ready = false;
    console.warn("[usageRepo] lastUsed rollup backfill failed:", error?.message || String(error));
    return false;
  }).finally(() => {
    dailyLastUsedState.promise = null;
  });

  return dailyLastUsedState.promise;
}

async function calculateCost(provider, model, tokens) {
  if (!tokens || !provider || !model) return 0;
  try {
    const { getPricingForModel } = await import("./pricingRepo.js");
    const pricing = await getPricingForModel(provider, model);
    if (!pricing) return 0;

    // Delegate the actual math to the single source of truth (avoids the two
    // copies drifting apart — see open-sse/providers/pricing.js for the
    // cache-inclusive prompt_tokens convention this assumes).
    const { calculateCostFromTokens } = await import("open-sse/providers/pricing.js");
    return calculateCostFromTokens(tokens, pricing);
  } catch (e) {
    console.error("Error calculating cost:", e);
    return 0;
  }
}

async function getUsageReferenceData(adapter) {
  if (referenceCache.adapter !== adapter) {
    referenceCache.adapter = adapter;
    referenceCache.value = null;
    referenceCache.updatedAt = 0;
    referenceCache.promise = null;
  }
  const now = Date.now();
  if (referenceCache.value && now - referenceCache.updatedAt < USAGE_REFERENCE_CACHE_TTL_MS) {
    return referenceCache.value;
  }
  if (referenceCache.promise) return referenceCache.promise;

  referenceCache.promise = Promise.all([
    import("./connectionsRepo.js"),
    import("./apiKeysRepo.js"),
    import("./nodesRepo.js"),
  ]).then(async ([connectionsRepo, apiKeysRepo, nodesRepo]) => {
    const [connections, apiKeys, nodes] = await Promise.all([
      connectionsRepo.getProviderConnections().catch(() => []),
      apiKeysRepo.getApiKeys().catch(() => []),
      nodesRepo.getProviderNodes().catch(() => []),
    ]);

    const connectionMap = {};
    for (const c of connections) connectionMap[c.id] = c.name || c.email || c.id;

    const providerNodeNameMap = {};
    for (const n of nodes) if (n.id && n.name) providerNodeNameMap[n.id] = n.name;

    const apiKeyMap = {};
    for (const k of apiKeys) {
      apiKeyMap[k.key] = { name: k.name, id: k.id, createdAt: k.createdAt };
      // usageHistory stores a fingerprint, not the raw key (see
      // helpers/apiKeyPrivacy.js), so index the fingerprint too — otherwise the
      // dashboard loses the human-readable key name and falls back to a prefix.
      const fp = fingerprintApiKey(k.key);
      if (fp && fp !== k.key) apiKeyMap[fp] = { name: k.name, id: k.id, createdAt: k.createdAt };
    }

    const value = { connectionMap, providerNodeNameMap, apiKeyMap };
    referenceCache.value = value;
    referenceCache.updatedAt = Date.now();
    return value;
  }).finally(() => {
    referenceCache.promise = null;
  });

  return referenceCache.promise;
}

export function trackPendingRequest(model, provider, connectionId, started, error = false) {
  const modelKey = provider ? `${model} (${provider})` : model;
  const timerKey = `${connectionId}|${modelKey}`;

  if (!pendingRequests.byModel[modelKey]) pendingRequests.byModel[modelKey] = 0;
  pendingRequests.byModel[modelKey] = Math.max(0, pendingRequests.byModel[modelKey] + (started ? 1 : -1));
  if (pendingRequests.byModel[modelKey] === 0) delete pendingRequests.byModel[modelKey];

  if (connectionId) {
    if (!pendingRequests.byAccount[connectionId]) pendingRequests.byAccount[connectionId] = {};
    if (!pendingRequests.byAccount[connectionId][modelKey]) pendingRequests.byAccount[connectionId][modelKey] = 0;
    pendingRequests.byAccount[connectionId][modelKey] = Math.max(0, pendingRequests.byAccount[connectionId][modelKey] + (started ? 1 : -1));
    if (pendingRequests.byAccount[connectionId][modelKey] === 0) {
      delete pendingRequests.byAccount[connectionId][modelKey];
      if (Object.keys(pendingRequests.byAccount[connectionId]).length === 0) {
        delete pendingRequests.byAccount[connectionId];
      }
    }
  }

  if (started) {
    clearTimeout(pendingTimers[timerKey]);
    pendingTimers[timerKey] = setTimeout(() => {
      delete pendingTimers[timerKey];
      if (pendingRequests.byModel[modelKey] > 0) pendingRequests.byModel[modelKey] = 0;
      if (connectionId && pendingRequests.byAccount[connectionId]?.[modelKey] > 0) {
        pendingRequests.byAccount[connectionId][modelKey] = 0;
      }
      scheduleStatsEvent("pending");
    }, PENDING_TIMEOUT_MS);
  } else {
    clearTimeout(pendingTimers[timerKey]);
    delete pendingTimers[timerKey];
  }

  if (!started && error && provider) {
    lastErrorProvider.provider = provider.toLowerCase();
    lastErrorProvider.ts = Date.now();
  }

  // [PENDING] console line removed; lifecycle is visible via "▶" and "📊 done" lines
  scheduleStatsEvent("pending");
}

export async function getActiveRequests() {
  const activeRequests = [];
  const connectionMap = await getConnectionMapCached();

  for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count > 0) {
        const accountName = connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`;
        const match = modelKey.match(/^(.*) \((.*)\)$/);
        activeRequests.push({
          model: match ? match[1] : modelKey,
          provider: match ? match[2] : "unknown",
          account: accountName, count,
        });
      }
    }
  }

  await ensureRingInitialized();
  const seen = new Set();
  const recentRequests = [...recentRing.items]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .map((e) => {
      const t = e.tokens || {};
      return {
        timestamp: e.timestamp, model: e.model, provider: e.provider || "",
        promptTokens: t.prompt_tokens || t.input_tokens || 0,
        completionTokens: t.completion_tokens || t.output_tokens || 0,
        status: e.status || "ok",
      };
    })
    .filter((e) => {
      // Allow 0 token entries
      const minute = e.timestamp ? e.timestamp.slice(0, 16) : "";
      const key = `${e.model}|${e.provider}|${e.promptTokens}|${e.completionTokens}|${minute}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);

  const errorProvider = (Date.now() - lastErrorProvider.ts < 10000) ? lastErrorProvider.provider : "";
  return { activeRequests, recentRequests, errorProvider };
}

export async function saveRequestUsage(entry) {
  try {
    const db = await getAdapter();

    // A caller-supplied timestamp identifies the same usage event across
    // duplicate completion paths. When no timestamp is supplied, this is a
    // new request even if several concurrent calls receive the same clock
    // millisecond; do not collapse independent requests into one row.
    const hasExplicitTimestamp = Boolean(entry.timestamp);
    if (!hasExplicitTimestamp) entry.timestamp = new Date().toISOString();
    entry.cost = await calculateCost(entry.provider, entry.model, entry.tokens);

    // Never persist a usable gateway key. Fingerprint ONCE, here, so the
    // dedup probe, the INSERT, the usageDaily rollup and the in-memory ring all
    // agree on the same value — mixing raw and fingerprinted forms would create
    // duplicate rows and split one key's stats across two buckets.
    // Callers keep their own object untouched apart from this field, which is
    // exactly what every downstream reader expects to see.
    entry.apiKey = fingerprintApiKey(entry.apiKey);

    const tokens = entry.tokens || {};
    const promptTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
    const completionTokens = tokens.completion_tokens || tokens.output_tokens || 0;

    let inserted = false;
    let insertedId = null;

    // All 3 writes (history insert, daily upsert, lifetime counter) in ONE transaction.
    // better-sqlite3 is sync → no JS yield mid-transaction → no race in same process.
    db.transaction(() => {
      const existing = hasExplicitTimestamp
        ? db.get(
          `SELECT id, endpoint FROM usageHistory
           WHERE timestamp = ?
             AND COALESCE(provider, '') = COALESCE(?, '')
             AND COALESCE(model, '') = COALESCE(?, '')
             AND COALESCE(connectionId, '') = COALESCE(?, '')
             AND COALESCE(apiKey, '') = COALESCE(?, '')
             AND promptTokens = ?
             AND completionTokens = ?
           ORDER BY id DESC LIMIT 1`,
          [
            entry.timestamp, entry.provider || null, entry.model || null,
            entry.connectionId || null, entry.apiKey || null,
            promptTokens, completionTokens,
          ]
        )
        : null;

      if (existing) {
        if (!existing.endpoint && entry.endpoint) {
          db.run(`UPDATE usageHistory SET endpoint = ? WHERE id = ?`, [entry.endpoint, existing.id]);
        }
        return;
      }

      const insertResult = db.run(
        `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.timestamp, entry.provider || null, entry.model || null,
          entry.connectionId || null, entry.apiKey || null, entry.endpoint || null,
          promptTokens, completionTokens, entry.cost || 0, entry.status || "ok",
          stringifyJson(tokens), stringifyJson({}),
        ]
      );
      insertedId = Number(insertResult?.lastInsertRowid ?? insertResult?.lastInsertRowID ?? 0) || null;

      const dateKey = getLocalDateKey(entry.timestamp);
      const row = db.get(`SELECT data FROM usageDaily WHERE dateKey = ?`, [dateKey]);
      const day = row ? parseJson(row.data, {}) : {
        requests: 0, promptTokens: 0, completionTokens: 0, cost: 0,
        byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
      };
      aggregateEntryToDay(day, entry);
      db.run(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data`, [dateKey, stringifyJson(day)]);

      // Atomic counter increment in same transaction
      const cur = db.get(`SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'`);
      const next = (cur ? parseInt(cur.value, 10) : 0) + 1;
      db.run(`INSERT INTO _meta(key, value) VALUES('totalRequestsLifetime', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(next)]);
      inserted = true;
    });

    if (inserted) {
      pushToRing(entry);
      if (insertedId !== null) {
        latestUsageIdState.adapter = db;
        latestUsageIdState.value = insertedId;
      }
      invalidateUsageStatsCache();
      scheduleStatsEvent("update", 250);
    }
  } catch (e) {
    console.error("Failed to save usage stats:", e);
  }
}

export async function getUsageHistory(filter = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];

  if (filter.provider) { conds.push("provider = ?"); params.push(filter.provider); }
  if (filter.model) { conds.push("model = ?"); params.push(filter.model); }
  if (filter.startDate) {
    const iso = toValidDateIso(filter.startDate);
    if (iso) { conds.push("timestamp >= ?"); params.push(iso); }
  }
  if (filter.endDate) {
    const iso = toValidDateIso(filter.endDate);
    if (iso) { conds.push("timestamp <= ?"); params.push(iso); }
  }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = db.all(`SELECT timestamp, provider, model, connectionId, apiKey, endpoint, cost, status, tokens FROM usageHistory ${where} ORDER BY id ASC`, params);

  return rows.map((r) => ({
    timestamp: r.timestamp, provider: r.provider, model: r.model,
    connectionId: r.connectionId, apiKeyMasked: maskApiKey(r.apiKey), endpoint: r.endpoint,
    cost: r.cost, status: r.status, tokens: parseJson(r.tokens, {}),
  }));
}

export async function getUsageHistoryPage(filter = {}, { limit = 100, cursor = null } = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];

  if (filter.provider) { conds.push("provider = ?"); params.push(filter.provider); }
  if (filter.model) { conds.push("model = ?"); params.push(filter.model); }
  if (filter.startDate) {
    const iso = toValidDateIso(filter.startDate);
    if (iso) { conds.push("timestamp >= ?"); params.push(iso); }
  }
  if (filter.endDate) {
    const iso = toValidDateIso(filter.endDate);
    if (iso) { conds.push("timestamp <= ?"); params.push(iso); }
  }

  const numericCursor = cursor === null || cursor === undefined || cursor === "" ? null : Number(cursor);
  if (Number.isFinite(numericCursor)) {
    conds.push("id > ?");
    params.push(numericCursor);
  }

  const normalizedLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = db.all(
    `SELECT id, timestamp, provider, model, connectionId, apiKey, endpoint, cost, status, tokens FROM usageHistory ${where} ORDER BY id ASC LIMIT ?`,
    [...params, normalizedLimit],
  );

  return {
    items: rows.map((r) => ({
      timestamp: r.timestamp, provider: r.provider, model: r.model,
      connectionId: r.connectionId, apiKeyMasked: maskApiKey(r.apiKey), endpoint: r.endpoint,
      cost: r.cost, status: r.status, tokens: parseJson(r.tokens, {}),
    })),
    nextCursor: rows.length === normalizedLimit ? Number(rows[rows.length - 1].id) : null,
  };
}

function loadDaysInRange(adapter, maxDays) {
  if (maxDays == null) {
    return adapter.all(`SELECT dateKey, data FROM usageDaily`);
  }
  const today = new Date();
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - maxDays + 1);
  const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
  return adapter.all(`SELECT dateKey, data FROM usageDaily WHERE dateKey >= ?`, [cutoffKey]);
}

async function calculateUsageStats(period = "all") {
  const db = await getAdapter();
  const { connectionMap, providerNodeNameMap, apiKeyMap } = await getUsageReferenceData(db);

  // recentRequests from live history (last 100 entries enough for 20 deduped)
  const recentRows = db.all(`SELECT timestamp, provider, model, tokens, status FROM usageHistory ORDER BY id DESC LIMIT 100`);
  const seen = new Set();
  const recentRequests = recentRows
    .map((r) => {
      const t = parseJson(r.tokens, {}) || {};
      return {
        timestamp: r.timestamp, model: r.model, provider: r.provider || "",
        promptTokens: t.prompt_tokens || t.input_tokens || 0,
        completionTokens: t.completion_tokens || t.output_tokens || 0,
        cachedTokens: t.cached_tokens || t.cache_read_input_tokens || 0,
        estimated: t.estimated === true,
        status: r.status || "ok",
      };
    })
    .filter((e) => {
      // Allow 0 token entries (e.g. streaming or failed requests) to show up in Recent Requests table
      const minute = e.timestamp ? e.timestamp.slice(0, 16) : "";
      const key = `${e.model}|${e.provider}|${e.promptTokens}|${e.completionTokens}|${minute}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);

  // avgLatencyMs — real latency from request details (latency.total) within the period window
  const nowMs = Date.now();
  const periodStartMs = (() => {
    if (period === "today") {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    if (period === "24h") return nowMs - 24 * 3600000;
    if (period === "7d") return nowMs - 7 * 86400000;
    if (period === "30d") return nowMs - 30 * 86400000;
    if (period === "60d") return nowMs - 60 * 86400000;
    return 0;
  })();
  let avgLatencyMs = 0;
  {
    const latencyRows = periodStartMs > 0
      ? db.all(`SELECT data FROM requestDetails WHERE timestamp >= ?`, [new Date(periodStartMs).toISOString()])
      : db.all(`SELECT data FROM requestDetails`);
    let totalLatency = 0;
    let latencyCount = 0;
    for (const row of latencyRows) {
      const latency = parseJson(row.data, {})?.latency;
      const ms = latency && typeof latency.total === "number" ? latency.total : 0;
      if (ms > 0) {
        totalLatency += ms;
        latencyCount++;
      }
    }
    if (latencyCount > 0) avgLatencyMs = Math.round(totalLatency / latencyCount);
  }

  const stats = {
    totalRequests: 0,
    totalPromptTokens: 0, totalCompletionTokens: 0, totalCachedTokens: 0, totalCost: 0,
    byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
    last10Minutes: [],
    pending: pendingRequests,
    activeRequests: [],
    recentRequests,
    avgLatencyMs,
    errorProvider: (Date.now() - lastErrorProvider.ts < 10000) ? lastErrorProvider.provider : "",
  };

  // Active requests
  for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count > 0) {
        const accountName = connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`;
        const match = modelKey.match(/^(.*) \((.*)\)$/);
        stats.activeRequests.push({
          model: match ? match[1] : modelKey,
          provider: match ? match[2] : "unknown",
          account: accountName, count,
        });
      }
    }
  }

  // last10Minutes — query 10min window
  const now = new Date();
  const currentMinuteStart = new Date(Math.floor(now.getTime() / 60000) * 60000);
  const tenMinutesAgo = new Date(currentMinuteStart.getTime() - 9 * 60 * 1000);
  const bucketMap = {};
  for (let i = 0; i < 10; i++) {
    const ts = currentMinuteStart.getTime() - (9 - i) * 60 * 1000;
    bucketMap[ts] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
    stats.last10Minutes.push(bucketMap[ts]);
  }
  const recent10 = db.all(
    `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ? AND timestamp <= ?`,
    [tenMinutesAgo.toISOString(), now.toISOString()]
  );
  for (const r of recent10) {
    const tt = new Date(r.timestamp).getTime();
    const minuteStart = Math.floor(tt / 60000) * 60000;
    if (bucketMap[minuteStart]) {
      bucketMap[minuteStart].requests++;
      bucketMap[minuteStart].promptTokens += r.promptTokens || 0;
      bucketMap[minuteStart].completionTokens += r.completionTokens || 0;
      bucketMap[minuteStart].cost += r.cost || 0;
    }
  }

  const useDailySummary = period !== "24h" && period !== "today";
  const dailyLastUsedReady = useDailySummary ? await ensureDailyLastUsed(db) : false;

  if (useDailySummary) {
    const periodDays = { "7d": 7, "30d": 30, "60d": 60 };
    const maxDays = periodDays[period] || null;
    const dayRows = loadDaysInRange(db, maxDays);

    for (const dr of dayRows) {
      const dateKey = dr.dateKey;
      const day = parseJson(dr.data, {});
      stats.totalPromptTokens += day.promptTokens || 0;
      stats.totalCompletionTokens += day.completionTokens || 0;
      stats.totalCachedTokens += day.cachedTokens || 0;
      stats.totalCost += day.cost || 0;

      for (const [prov, p] of Object.entries(day.byProvider || {})) {
        if (!stats.byProvider[prov]) stats.byProvider[prov] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
        stats.byProvider[prov].requests += p.requests || 0;
        stats.byProvider[prov].promptTokens += p.promptTokens || 0;
        stats.byProvider[prov].completionTokens += p.completionTokens || 0;
        stats.byProvider[prov].cachedTokens += p.cachedTokens || 0;
        stats.byProvider[prov].cost += p.cost || 0;
      }

      for (const [mk, m] of Object.entries(day.byModel || {})) {
        const rawModel = m.rawModel || mk.split("|")[0];
        const provider = m.provider || mk.split("|")[1] || "";
        const statsKey = provider ? `${rawModel} (${provider})` : rawModel;
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        if (!stats.byModel[statsKey]) {
          stats.byModel[statsKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel, provider: providerDisplayName, lastUsed: m.lastUsed || dateKey };
        }
        stats.byModel[statsKey].requests += m.requests || 0;
        stats.byModel[statsKey].promptTokens += m.promptTokens || 0;
        stats.byModel[statsKey].completionTokens += m.completionTokens || 0;
        stats.byModel[statsKey].cachedTokens += m.cachedTokens || 0;
        stats.byModel[statsKey].cost += m.cost || 0;
        stats.byModel[statsKey].lastUsed = maxTimestamp(stats.byModel[statsKey].lastUsed, m.lastUsed || dateKey);
      }

      for (const [connId, a] of Object.entries(day.byAccount || {})) {
        const accountName = connectionMap[connId] || `Account ${connId.slice(0, 8)}...`;
        const rawModel = a.rawModel || "";
        const provider = a.provider || "";
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        const accountKey = `${rawModel} (${provider} - ${accountName})`;
        if (!stats.byAccount[accountKey]) {
          stats.byAccount[accountKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel, provider: providerDisplayName, connectionId: connId, accountName, lastUsed: a.lastUsed || dateKey };
        }
        stats.byAccount[accountKey].requests += a.requests || 0;
        stats.byAccount[accountKey].promptTokens += a.promptTokens || 0;
        stats.byAccount[accountKey].completionTokens += a.completionTokens || 0;
        stats.byAccount[accountKey].cachedTokens += a.cachedTokens || 0;
        stats.byAccount[accountKey].cost += a.cost || 0;
        stats.byAccount[accountKey].lastUsed = maxTimestamp(stats.byAccount[accountKey].lastUsed, a.lastUsed || dateKey);
      }

      for (const [akKey, ak] of Object.entries(day.byApiKey || {})) {
        const rawModel = ak.rawModel || "";
        const provider = ak.provider || "";
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        const apiKeyVal = ak.apiKey;
        const keyInfo = apiKeyVal ? apiKeyMap[apiKeyVal] : null;
        const keyName = keyInfo?.name || (apiKeyVal ? apiKeyVal.slice(0, 8) + "..." : "Local (No API Key)");
        const apiKeyMasked = maskApiKey(apiKeyVal);
        const apiKeyKey = apiKeyMasked || "local-no-key";
        if (!stats.byApiKey[akKey]) {
          stats.byApiKey[akKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel, provider: providerDisplayName, apiKeyMasked, keyName, apiKeyKey, lastUsed: ak.lastUsed || dateKey };
        }
        stats.byApiKey[akKey].requests += ak.requests || 0;
        stats.byApiKey[akKey].promptTokens += ak.promptTokens || 0;
        stats.byApiKey[akKey].completionTokens += ak.completionTokens || 0;
        stats.byApiKey[akKey].cachedTokens += ak.cachedTokens || 0;
        stats.byApiKey[akKey].cost += ak.cost || 0;
        stats.byApiKey[akKey].lastUsed = maxTimestamp(stats.byApiKey[akKey].lastUsed, ak.lastUsed || dateKey);
      }

      for (const [epKey, ep] of Object.entries(day.byEndpoint || {})) {
        const endpoint = ep.endpoint || epKey.split("|")[0] || "Unknown";
        const rawModel = ep.rawModel || "";
        const provider = ep.provider || "";
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        if (!stats.byEndpoint[epKey]) {
          stats.byEndpoint[epKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, endpoint, rawModel, provider: providerDisplayName, lastUsed: ep.lastUsed || dateKey };
        }
        stats.byEndpoint[epKey].requests += ep.requests || 0;
        stats.byEndpoint[epKey].promptTokens += ep.promptTokens || 0;
        stats.byEndpoint[epKey].completionTokens += ep.completionTokens || 0;
        stats.byEndpoint[epKey].cachedTokens += ep.cachedTokens || 0;
        stats.byEndpoint[epKey].cost += ep.cost || 0;
        stats.byEndpoint[epKey].lastUsed = maxTimestamp(stats.byEndpoint[epKey].lastUsed, ep.lastUsed || dateKey);
      }
    }

    // Older databases may not have the precise timestamp fields yet. Keep
    // the old overlay as a one-time fallback until the rollup backfill succeeds.
    if (!dailyLastUsedReady) {
      const overlayCutoff = maxDays ? Date.now() - maxDays * 86400000 : 0;
      const histRows = db.all(
        `SELECT timestamp, provider, model, connectionId, apiKey, endpoint FROM usageHistory WHERE timestamp >= ?`,
        [new Date(overlayCutoff).toISOString()]
      );
      for (const e of histRows) {
        const ts = e.timestamp;
        const modelKey = e.provider ? `${e.model} (${e.provider})` : e.model;
        if (stats.byModel[modelKey]) stats.byModel[modelKey].lastUsed = maxTimestamp(stats.byModel[modelKey].lastUsed, ts);

        if (e.connectionId) {
          const accountName = connectionMap[e.connectionId] || `Account ${e.connectionId.slice(0, 8)}...`;
          const accountKey = `${e.model} (${e.provider} - ${accountName})`;
          if (stats.byAccount[accountKey]) stats.byAccount[accountKey].lastUsed = maxTimestamp(stats.byAccount[accountKey].lastUsed, ts);
        }

        const apiKeyKey = (e.apiKey && typeof e.apiKey === "string")
          ? `${e.apiKey}|${e.model}|${e.provider || "unknown"}`
          : "local-no-key";
        if (stats.byApiKey[apiKeyKey]) stats.byApiKey[apiKeyKey].lastUsed = maxTimestamp(stats.byApiKey[apiKeyKey].lastUsed, ts);

        const endpoint = e.endpoint || "Unknown";
        const endpointKey = `${endpoint}|${e.model}|${e.provider || "unknown"}`;
        if (stats.byEndpoint[endpointKey]) stats.byEndpoint[endpointKey].lastUsed = maxTimestamp(stats.byEndpoint[endpointKey].lastUsed, ts);
      }
    }
  } else {
    // 24h / today: live history
    let cutoff;
    if (period === "today") {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      cutoff = startOfDay.toISOString();
    } else {
      cutoff = new Date(Date.now() - PERIOD_MS["24h"]).toISOString();
    }
    const filtered = db.all(
      `SELECT timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, tokens FROM usageHistory WHERE timestamp >= ?`,
      [cutoff]
    );

    for (const r of filtered) {
      const tokens = parseJson(r.tokens, {}) || {};
      const promptTokens = tokens.prompt_tokens || 0;
      const completionTokens = tokens.completion_tokens || 0;
      const cachedTokens = tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
      const entryCost = r.cost || 0;
      const providerDisplayName = providerNodeNameMap[r.provider] || r.provider;

      stats.totalPromptTokens += promptTokens;
      stats.totalCompletionTokens += completionTokens;
      stats.totalCachedTokens += cachedTokens;
      stats.totalCost += entryCost;

      if (!stats.byProvider[r.provider]) stats.byProvider[r.provider] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
      stats.byProvider[r.provider].requests++;
      stats.byProvider[r.provider].promptTokens += promptTokens;
      stats.byProvider[r.provider].completionTokens += completionTokens;
      stats.byProvider[r.provider].cachedTokens += cachedTokens;
      stats.byProvider[r.provider].cost += entryCost;

      const modelKey = r.provider ? `${r.model} (${r.provider})` : r.model;
      if (!stats.byModel[modelKey]) {
        stats.byModel[modelKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, lastUsed: r.timestamp };
      }
      stats.byModel[modelKey].requests++;
      stats.byModel[modelKey].promptTokens += promptTokens;
      stats.byModel[modelKey].completionTokens += completionTokens;
      stats.byModel[modelKey].cachedTokens += cachedTokens;
      stats.byModel[modelKey].cost += entryCost;
      if (new Date(r.timestamp) > new Date(stats.byModel[modelKey].lastUsed)) stats.byModel[modelKey].lastUsed = r.timestamp;

      if (r.connectionId) {
        const accountName = connectionMap[r.connectionId] || `Account ${r.connectionId.slice(0, 8)}...`;
        const accountKey = `${r.model} (${r.provider} - ${accountName})`;
        if (!stats.byAccount[accountKey]) {
          stats.byAccount[accountKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, connectionId: r.connectionId, accountName, lastUsed: r.timestamp };
        }
        stats.byAccount[accountKey].requests++;
        stats.byAccount[accountKey].promptTokens += promptTokens;
        stats.byAccount[accountKey].completionTokens += completionTokens;
        stats.byAccount[accountKey].cachedTokens += cachedTokens;
        stats.byAccount[accountKey].cost += entryCost;
        if (new Date(r.timestamp) > new Date(stats.byAccount[accountKey].lastUsed)) stats.byAccount[accountKey].lastUsed = r.timestamp;
      }

      if (r.apiKey && typeof r.apiKey === "string") {
        const keyInfo = apiKeyMap[r.apiKey];
        const keyName = keyInfo?.name || r.apiKey.slice(0, 8) + "...";
        const apiKeyMasked = maskApiKey(r.apiKey);
        const akKey = `${apiKeyMasked}|${r.model}|${r.provider || "unknown"}`;
        if (!stats.byApiKey[akKey]) {
          stats.byApiKey[akKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, apiKeyMasked, keyName, apiKeyKey: apiKeyMasked, lastUsed: r.timestamp };
        }
        const ake = stats.byApiKey[akKey];
        ake.requests++; ake.promptTokens += promptTokens; ake.completionTokens += completionTokens; ake.cachedTokens += cachedTokens; ake.cost += entryCost;
        if (new Date(r.timestamp) > new Date(ake.lastUsed)) ake.lastUsed = r.timestamp;
      } else {
        if (!stats.byApiKey["local-no-key"]) {
          stats.byApiKey["local-no-key"] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, apiKeyMasked: null, keyName: "Local (No API Key)", apiKeyKey: "local-no-key", lastUsed: r.timestamp };
        }
        const ake = stats.byApiKey["local-no-key"];
        ake.requests++; ake.promptTokens += promptTokens; ake.completionTokens += completionTokens; ake.cachedTokens += cachedTokens; ake.cost += entryCost;
        if (new Date(r.timestamp) > new Date(ake.lastUsed)) ake.lastUsed = r.timestamp;
      }

      const endpoint = r.endpoint || "Unknown";
      const epKey = `${endpoint}|${r.model}|${r.provider || "unknown"}`;
      if (!stats.byEndpoint[epKey]) {
        stats.byEndpoint[epKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, endpoint, rawModel: r.model, provider: providerDisplayName, lastUsed: r.timestamp };
      }
      const epe = stats.byEndpoint[epKey];
      epe.requests++; epe.promptTokens += promptTokens; epe.completionTokens += completionTokens; epe.cachedTokens += cachedTokens; epe.cost += entryCost;
      if (new Date(r.timestamp) > new Date(epe.lastUsed)) epe.lastUsed = r.timestamp;
    }
  }

  stats.totalRequests = Object.values(stats.byProvider).reduce((sum, p) => sum + (p.requests || 0), 0);
  return stats;
}

export async function getUsageStats(period = "all") {
  const key = period || "all";
  const now = Date.now();
  const cached = statsCache.entries.get(key);

  if (cached?.value && cached.version === statsCache.version && now - cached.updatedAt < USAGE_STATS_CACHE_TTL_MS) {
    return cached.value;
  }
  if (cached?.promise) return cached.promise;

  const version = statsCache.version;
  const promise = calculateUsageStats(key)
    .then((value) => {
      if (version === statsCache.version) {
        statsCache.entries.set(key, { value, updatedAt: Date.now(), version });
      }
      return value;
    });

  statsCache.entries.set(key, { ...(cached || {}), promise, version, updatedAt: cached?.updatedAt || 0 });
  promise.finally(() => {
    const current = statsCache.entries.get(key);
    if (current?.promise === promise) {
      if (current.value) {
        statsCache.entries.set(key, current);
      } else {
        statsCache.entries.delete(key);
      }
    }
  }).catch(() => {});
  return promise;
}

async function calculateChartData(period = "7d") {
  const db = await getAdapter();
  const now = Date.now();

  if (period === "today") {
    const bucketCount = 24;
    const bucketMs = 3600000;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startTime = startOfDay.getTime();
    const endTime = startTime + bucketCount * bucketMs;
    const labelFn = (ts) => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({ label: labelFn(startTime + i * bucketMs), tokens: 0, cost: 0 }));

    const rows = db.all(
      `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ?`,
      [new Date(startTime).toISOString()]
    );
    for (const r of rows) {
      const t = new Date(r.timestamp).getTime();
      if (t < startTime || t >= endTime) continue;
      const idx = Math.floor((t - startTime) / bucketMs);
      if (idx >= 0 && idx < bucketCount) {
        buckets[idx].tokens += (r.promptTokens || 0) + (r.completionTokens || 0);
        buckets[idx].cost += r.cost || 0;
      }
    }
    return buckets;
  }

  if (period === "24h") {
    const bucketCount = 24;
    const bucketMs = 3600000;
    const labelFn = (ts) => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const startTime = now - bucketCount * bucketMs;
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({ label: labelFn(startTime + i * bucketMs), tokens: 0, cost: 0 }));

    const rows = db.all(
      `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ?`,
      [new Date(startTime).toISOString()]
    );
    for (const r of rows) {
      const t = new Date(r.timestamp).getTime();
      if (t < startTime || t > now) continue;
      const idx = Math.min(Math.floor((t - startTime) / bucketMs), bucketCount - 1);
      buckets[idx].tokens += (r.promptTokens || 0) + (r.completionTokens || 0);
      buckets[idx].cost += r.cost || 0;
    }
    return buckets;
  }

  const bucketCount = period === "7d" ? 7 : period === "30d" ? 30 : 60;
  const today = new Date();
  const labelFn = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  // Build map of dateKey → day data
  const dayRows = loadDaysInRange(db, bucketCount);
  const dayMap = {};
  for (const r of dayRows) dayMap[r.dateKey] = parseJson(r.data, {});

  return Array.from({ length: bucketCount }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (bucketCount - 1 - i));
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const dayData = dayMap[dateKey];
    return {
      label: labelFn(d),
      tokens: dayData ? (dayData.promptTokens || 0) + (dayData.completionTokens || 0) : 0,
      cost: dayData ? (dayData.cost || 0) : 0,
    };
  });
}

export async function getChartData(period = "7d") {
  const key = period || "7d";
  const now = Date.now();
  const cached = chartCache.entries.get(key);
  if (cached?.value && cached.version === chartCache.version && now - cached.updatedAt < USAGE_CHART_CACHE_TTL_MS) {
    return cached.value;
  }
  if (cached?.promise) return cached.promise;

  const version = chartCache.version;
  const promise = calculateChartData(key).then((value) => {
    if (version === chartCache.version) {
      chartCache.entries.set(key, { value, updatedAt: Date.now(), version });
    }
    return value;
  });
  chartCache.entries.set(key, { ...(cached || {}), promise, version, updatedAt: cached?.updatedAt || 0 });
  promise.finally(() => {
    const current = chartCache.entries.get(key);
    if (current?.promise === promise && !current.value) chartCache.entries.delete(key);
  }).catch(() => {});
  return promise;
}

function formatLogDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// No-op: request log is now derived from usageHistory table on read.
export async function appendRequestLog() {}

export async function getLatestUsageId() {
  const db = await getAdapter();
  if (latestUsageIdState.adapter !== db) {
    latestUsageIdState.adapter = db;
    latestUsageIdState.value = null;
  }
  if (latestUsageIdState.value !== null) return latestUsageIdState.value;
  const row = db.get(`SELECT id FROM usageHistory ORDER BY id DESC LIMIT 1`);
  latestUsageIdState.value = Number(row?.id || 0);
  return latestUsageIdState.value;
}

function formatRecentLogRow(row, connectionMap) {
  const ts = formatLogDate(new Date(row.timestamp));
  const p = row.provider?.toUpperCase() || "-";
  const m = row.model || "-";
  const account = connectionMap[row.connectionId] || (row.connectionId ? row.connectionId.slice(0, 8) : "-");
  const tk = row.tokens ? parseJson(row.tokens, {}) : {};
  const sent = row.promptTokens ?? tk.prompt_tokens ?? "-";
  const received = row.completionTokens ?? tk.completion_tokens ?? "-";
  return `${ts} | ${m} | ${p} | ${account} | ${sent} | ${received} | ${row.status || "-"}`;
}

export async function getRecentLogsPage(limit = 200, { afterId = null } = {}) {
  try {
    const db = await getAdapter();
    const latestId = await getLatestUsageId();
    const normalizedLimit = Math.max(1, Number(limit) || 200);
    const numericAfterId = afterId === null || afterId === undefined || afterId === ""
      ? null
      : Number(afterId);
    const validAfterId = Number.isFinite(numericAfterId) ? numericAfterId : null;
    const rows = validAfterId === null
      ? db.all(
        `SELECT id, timestamp, provider, model, connectionId, promptTokens, completionTokens, status, tokens FROM usageHistory ORDER BY id DESC LIMIT ?`,
        [normalizedLimit],
      )
      : db.all(
        `SELECT id, timestamp, provider, model, connectionId, promptTokens, completionTokens, status, tokens FROM usageHistory WHERE id > ? ORDER BY id ASC LIMIT ?`,
        [validAfterId, normalizedLimit],
      );

    const connMap = await getConnectionMapCached();
    return {
      logs: rows.map((row) => formatRecentLogRow(row, connMap)),
      latestId,
      cursorId: rows.length
        ? Number(validAfterId === null ? rows[0].id : rows[rows.length - 1].id)
        : (validAfterId ?? latestId),
      reset: validAfterId !== null && latestId < validAfterId,
    };
  } catch (e) {
    console.error("[usageRepo] getRecentLogs failed:", e.message);
    return { logs: [], latestId: 0, cursorId: 0, reset: false };
  }
}

export async function getRecentLogs(limit = 200, options = {}) {
  const page = await getRecentLogsPage(limit, options);
  return page.logs;
}
