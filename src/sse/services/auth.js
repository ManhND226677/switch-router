import { getProviderConnections, validateApiKey, updateProviderConnection, updateProviderConnectionsBatch, getSettings, getProxyPools } from "@/lib/localDb";
import { resolveConnectionProxyConfig, pickProxyPoolId } from "@/lib/network/connectionProxy";
import { formatRetryAfter, checkFallbackError, isModelLockActive, buildModelLockUpdate, getEarliestModelLockUntil } from "open-sse/services/accountFallback.js";
import { pickFastestConnection, hydrateConnectionLatency } from "open-sse/services/connectionLatency.js";
import { getPinnedConnection } from "open-sse/services/sessionPinning.js";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "open-sse/config/errorConfig.js";
import { resolveProviderId, FREE_PROVIDERS } from "@/shared/constants/providers.js";
import { getProviderRoutingPolicy } from "@/core/routing/routingConfig.js";
import { buildRuntimeCredentials } from "@/core/credentials/credentialProjection.js";
import * as log from "../utils/logger.js";

// Per-provider mutex: concurrent requests for different providers no longer
// serialize each other. Same-provider selection still serializes so sticky-RR
// counters stay consistent under concurrency — but only the (synchronous)
// strategy decision itself runs inside the lock; DB reads and proxy resolution
// happen outside so bursts don't queue behind each other's I/O.
if (!global._providerSelectionMutex) global._providerSelectionMutex = new Map();
const providerMutexes = global._providerSelectionMutex;

async function withProviderSelectionLock(providerId, fn) {
  const prev = providerMutexes.get(providerId) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  // Chain must be the Map value we compare against on release (not `gate` alone).
  const chained = prev.then(() => gate, () => gate);
  providerMutexes.set(providerId, chained);
  try {
    await prev;
    return await fn();
  } finally {
    release();
    // Drop settled tail so the map does not grow forever for idle providers.
    if (providerMutexes.get(providerId) === chained) providerMutexes.delete(providerId);
  }
}

// In-memory sticky-RR counters. Selection only touches memory; a write-behind
// queue persists counters in one batched transaction every few seconds so the
// 1s connections list cache is not invalidated (forcing a re-SELECT + re-parse
// of every connection) on every request. DB remains the source of truth for
// locks/tokens; losing ≤5s of counters on a crash is harmless.
if (!global._rrStickyState) global._rrStickyState = new Map();
const rrStickyState = global._rrStickyState; // connectionId -> { lastUsedAt, consecutiveUseCount }

if (!global._rrPersistQueue) global._rrPersistQueue = { pending: new Set(), flushing: false, timer: null };
const rrPersist = global._rrPersistQueue;
const RR_PERSIST_INTERVAL_MS = 5000;

function overlayRrState(connection) {
  const mem = rrStickyState.get(connection.id);
  if (!mem) return connection;
  return {
    ...connection,
    lastUsedAt: mem.lastUsedAt || connection.lastUsedAt,
    consecutiveUseCount: mem.consecutiveUseCount ?? connection.consecutiveUseCount,
  };
}

function scheduleRrPersist() {
  if (rrPersist.timer || rrPersist.flushing) return;
  rrPersist.timer = setTimeout(() => {
    rrPersist.timer = null;
    flushRrCounters().catch(() => {});
  }, RR_PERSIST_INTERVAL_MS);
  // Never hold the event loop open just for counter persistence.
  rrPersist.timer.unref?.();
}

/**
 * Flush pending sticky-RR counters to DB in one batched transaction.
 * Exported so shutdown paths can drain the queue before exit.
 */
export async function flushRrCounters() {
  if (rrPersist.flushing || rrPersist.pending.size === 0) return;
  rrPersist.flushing = true;
  const ids = [...rrPersist.pending];
  for (const id of ids) rrPersist.pending.delete(id);
  try {
    const updates = {};
    for (const id of ids) {
      const latest = rrStickyState.get(id);
      if (latest) updates[id] = latest;
    }
    if (Object.keys(updates).length > 0) {
      await updateProviderConnectionsBatch(updates);
    }
  } catch (err) {
    // Re-queue for the next scheduled flush — counters are acceleration data only.
    for (const id of ids) rrPersist.pending.add(id);
    log.warn?.("AUTH", `RR sticky persist failed: ${err?.message || err}`);
  } finally {
    rrPersist.flushing = false;
    if (rrPersist.pending.size > 0) scheduleRrPersist();
  }
}

function recordRrUse(connectionId, consecutiveUseCount) {
  rrStickyState.set(connectionId, { lastUsedAt: new Date().toISOString(), consecutiveUseCount });
  rrPersist.pending.add(connectionId);
  scheduleRrPersist();
}

/**
 * Get provider credentials from localDb
 * Filters out unavailable accounts and returns the selected account based on strategy
 * @param {string} provider - Provider name
 * @param {Set<string>|string|null} excludeConnectionIds - Connection ID(s) to exclude (for retry with next account)
 * @param {string|null} model - Model name for per-model rate limit filtering
 */
export async function getProviderCredentials(provider, excludeConnectionIds = null, model = null, options = {}) {
  // Normalize to Set for consistent handling
  const excludeSet = excludeConnectionIds instanceof Set
    ? excludeConnectionIds
    : (excludeConnectionIds ? new Set([excludeConnectionIds]) : new Set());
  const preferredConnectionId = options?.preferredConnectionId || null;
  const sessionKey = options?.sessionKey || null;

  // Resolve alias to provider ID (e.g., "kc" -> "kilocode") before locking
  // so different aliases of the same provider share one mutex.
  const providerId = resolveProviderId(provider);

  // Inject a virtual connection for no-auth free providers (with optional proxy pool from settings).
  // No sticky-RR state is involved → no selection lock needed.
  if (FREE_PROVIDERS[providerId]?.noAuth) {
    const settings = await getSettings();
    const policy = getProviderRoutingPolicy(settings, providerId);
    const strategy = policy.rotateStrategy;
    let pickedId = policy.proxyPoolId;
    if (strategy !== "none") {
      const allPools = await getProxyPools({ isActive: true });
      const poolIds = allPools.filter(p => p.proxyUrl).map(p => p.id);
      pickedId = pickProxyPoolId(poolIds, strategy, providerId);
    }
    const resolvedProxy = await resolveConnectionProxyConfig({ proxyPoolId: pickedId || "" });
    return {
      id: "noauth",
      connectionName: "Public",
      isActive: true,
      accessToken: "public",
      providerSpecificData: {
        connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
        connectionProxyUrl: resolvedProxy.connectionProxyUrl,
        connectionNoProxy: resolvedProxy.connectionNoProxy,
        connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
      },
    };
  }

  // Reads happen OUTSIDE the selection lock: both list (1s TTL) and settings are
  // cached, and concurrent same-provider requests no longer queue behind each
  // other's DB reads. Only the synchronous sticky-RR decision stays serialized.
  const [connections, settings] = await Promise.all([
    getProviderConnections({ provider: providerId, isActive: true }),
    getSettings(),
  ]);
  log.debug("AUTH", `${provider} | total connections: ${connections.length}, excludeIds: ${excludeSet.size > 0 ? [...excludeSet].join(",") : "none"}, model: ${model || "any"}`);

  if (connections.length === 0) {
    log.warn("AUTH", `No credentials for ${provider}`);
    return null;
  }

  // Filter out model-locked and excluded connections (RR overlays are applied
  // later, inside the lock, so consecutive requests always see the latest counters).
  const filteredOut = [];
  const availableConnections = connections.filter(c => {
    if (excludeSet.has(c.id)) { filteredOut.push({ c, excluded: true }); return false; }
    if (isModelLockActive(c, model)) { filteredOut.push({ c, excluded: false }); return false; }
    return true;
  });

  for (const { c, excluded } of filteredOut) {
    const lockUntil = excluded ? null : getEarliestModelLockUntil(c);
    log.debug("AUTH", `  → ${c.id?.slice(0, 8)} | ${excluded ? "excluded" : ""} ${!excluded ? `modelLocked(${model}) until ${lockUntil}` : ""}`);
  }
  log.debug("AUTH", `${provider} | available: ${availableConnections.length}/${connections.length}`);

  if (availableConnections.length === 0) {
    // Find earliest lock expiry across all connections for retry timing
    const lockedConns = connections.filter(c => isModelLockActive(c, model));
    const expiries = lockedConns.map(c => getEarliestModelLockUntil(c)).filter(Boolean);
    const earliest = expiries.sort()[0] || null;
    if (earliest) {
      const earliestConn = lockedConns[0];
      log.warn("AUTH", `${provider} | all ${connections.length} accounts locked for ${model || "all"} (${formatRetryAfter(earliest)}) | lastError=${earliestConn?.lastError?.slice(0, 50)}`);
      return {
        allRateLimited: true,
        retryAfter: earliest,
        retryAfterHuman: formatRetryAfter(earliest),
        lastError: earliestConn?.lastError || null,
        lastErrorCode: earliestConn?.errorCode || null
      };
    }
    log.warn("AUTH", `${provider} | all ${connections.length} accounts unavailable`);
    return null;
  }

  const policy = getProviderRoutingPolicy(settings, providerId);
  const strategy = policy.fallbackStrategy;

  // "fastest" needs the persisted latency EWMA; hydrate once per process before
  // deciding, outside the lock (the decision itself stays synchronous).
  if (strategy === "fastest") await hydrateConnectionLatency();

  // Serialize ONLY the strategy decision (synchronous, in-memory) so sticky-RR
  // counters stay consistent; hold time is microseconds instead of spanning
  // DB reads, sorts with Date parsing, and proxy resolution.
  const connection = await withProviderSelectionLock(providerId, () =>
    selectConnectionByStrategy(availableConnections.map(overlayRrState), policy, strategy, preferredConnectionId, provider, sessionKey));

  const resolvedProxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});

  return buildRuntimeCredentials(connection, resolvedProxy);
}

/**
 * Pure, synchronous strategy decision — must run inside the provider selection
 * lock because it reads and mutates the sticky-RR counters.
 */
function selectConnectionByStrategy(availableConnections, policy, strategy, preferredConnectionId, provider, sessionKey = null) {
  let connection;
  // Pin to preferred connection if specified and available
  if (preferredConnectionId) {
    connection = availableConnections.find((c) => c.id === preferredConnectionId);
    if (connection) {
      log.info("AUTH", `${provider} | pinned to ${connection.id?.slice(0, 8)} (${connection.name || connection.email || "unnamed"})`);
    }
  }
  // Conversation affinity: keep a running conversation on the account that
  // served its previous turn (that is where the upstream prompt cache lives).
  // `availableConnections` is already free of excluded/model-locked accounts,
  // so a degraded pin falls through to the normal strategy by itself.
  if (!connection && sessionKey) {
    const pinnedId = getPinnedConnection(sessionKey);
    connection = pinnedId ? availableConnections.find((c) => c.id === pinnedId) : null;
    if (connection) {
      log.debug("AUTH", `${provider} | session affinity → ${connection.id?.slice(0, 8)} (${connection.name || connection.email || "unnamed"})`);
      if (strategy === "round-robin") recordRrUse(connection.id, 1);
    }
  }
  if (connection) {
    // skip strategy
  } else if (strategy === "round-robin") {
    const stickyLimit = policy.stickyRoundRobinLimit;

    // Sort by lastUsed (most recent first) to find current candidate
    const byRecency = [...availableConnections].sort((a, b) => {
      if (!a.lastUsedAt && !b.lastUsedAt) return (a.priority || 999) - (b.priority || 999);
      if (!a.lastUsedAt) return 1;
      if (!b.lastUsedAt) return -1;
      return new Date(b.lastUsedAt) - new Date(a.lastUsedAt);
    });

    const current = byRecency[0];
    const currentCount = current?.consecutiveUseCount || 0;

    if (current && current.lastUsedAt && currentCount < stickyLimit) {
      // Stay with current account
      connection = current;
      recordRrUse(connection.id, (connection.consecutiveUseCount || 0) + 1);
    } else {
      // Pick the least recently used (excluding current if possible)
      const sortedByOldest = [...availableConnections].sort((a, b) => {
        if (!a.lastUsedAt && !b.lastUsedAt) return (a.priority || 999) - (b.priority || 999);
        if (!a.lastUsedAt) return -1;
        if (!b.lastUsedAt) return 1;
        return new Date(a.lastUsedAt) - new Date(b.lastUsedAt);
      });

      connection = sortedByOldest[0];
      recordRrUse(connection.id, 1);
    }
  } else if (strategy === "fastest") {
    // Latency-aware: pick the account with the freshest lowest EWMA TTFT.
    // Unsampled accounts get the median score so they still receive traffic;
    // with no samples at all this degrades to fill-first priority order.
    connection = pickFastestConnection(availableConnections);
  } else {
    // Default: fill-first (already sorted by priority in getProviderConnections)
    connection = availableConnections[0];
  }
  return connection;
}

/**
 * Mark account+model as unavailable — locks modelLock_${model} in DB.
 * All errors (429, 401, 5xx, etc.) lock per model, not per account.
 * @param {string} connectionId
 * @param {number} status - HTTP status code from upstream
 * @param {string} errorText
 * @param {string|null} provider
 * @param {string|null} model - The specific model that triggered the error
 * @returns {{ shouldFallback: boolean, cooldownMs: number, payloadFault?: boolean }}
 */
export async function markAccountUnavailable(connectionId, status, errorText, provider = null, model = null, resetsAtMs = null) {
  if (!connectionId || connectionId === "noauth") return { shouldFallback: false, cooldownMs: 0 };
  const connections = await getProviderConnections({ provider });
  const conn = connections.find(c => c.id === connectionId);
  const backoffLevel = conn?.backoffLevel || 0;

  const classified = checkFallbackError(status, errorText, backoffLevel);
  // A rejected payload is not this account's fault, and no sibling account
  // behind the same model window will accept it either — so skip the lock and
  // stop account rotation. Combo model rotation is decided upstream.
  if (classified.payloadFault) return { shouldFallback: false, cooldownMs: 0, payloadFault: true };

  // Provider-specific precise cooldown (e.g. codex usage_limit_reached resets_at) overrides backoff
  let shouldFallback, cooldownMs, newBackoffLevel;
  if (resetsAtMs && resetsAtMs > Date.now()) {
    shouldFallback = true;
    cooldownMs = Math.min(resetsAtMs - Date.now(), MAX_RATE_LIMIT_COOLDOWN_MS);
    newBackoffLevel = 0;
  } else {
    ({ shouldFallback, cooldownMs, newBackoffLevel } = classified);
  }
  if (!shouldFallback) return { shouldFallback: false, cooldownMs: 0 };
  // cooldownMs 0 = "not this account's fault" (deterministic client 4xx). Still
  // rotate so a combo advances to its next model, but never write a lock or
  // mark the account unhealthy for it.
  if (!(cooldownMs > 0)) return { shouldFallback: true, cooldownMs: 0 };

  const reason = typeof errorText === "string" ? errorText.slice(0, 100) : "Provider error";
  const lockUpdate = buildModelLockUpdate(model, cooldownMs);

  await updateProviderConnection(connectionId, {
    ...lockUpdate,
    testStatus: "unavailable",
    lastError: reason,
    errorCode: status,
    lastErrorAt: new Date().toISOString(),
    backoffLevel: newBackoffLevel ?? backoffLevel
  });

  const lockKey = Object.keys(lockUpdate)[0];
  const connName = conn?.displayName || conn?.name || conn?.email || connectionId.slice(0, 8);
  log.warn("AUTH", `${connName} locked ${lockKey} for ${Math.round(cooldownMs / 1000)}s [${status}]`);

  if (provider && status && reason) {
    console.error(`❌ ${provider} [${status}]: ${reason}`);
  }

  return { shouldFallback: true, cooldownMs };
}

/**
 * Clear account error status on successful request.
 * - Clears modelLock_${model} (the model that just succeeded)
 * - Lazy-cleans any other expired modelLock_* keys
 * - Resets error state only if no active locks remain
 * @param {string} connectionId
 * @param {object} currentConnection - credentials object (has _connection) or raw connection
 * @param {string|null} model - model that succeeded
 */
export async function clearAccountError(connectionId, currentConnection, model = null) {
  if (!connectionId || connectionId === "noauth") return;
  const conn = currentConnection._connection || currentConnection;
  const now = Date.now();
  const allLockKeys = Object.keys(conn).filter(k => k.startsWith("modelLock_"));

  if (!conn.testStatus && !conn.lastError && allLockKeys.length === 0) return;

  // Keys to clear: current model's lock + all expired locks
  const keysToClear = allLockKeys.filter(k => {
    if (model && k === `modelLock_${model}`) return true; // succeeded model
    if (model && k === "modelLock___all") return true;    // account-level lock
    const expiry = conn[k];
    return expiry && new Date(expiry).getTime() <= now;   // expired
  });

  if (keysToClear.length === 0 && conn.testStatus !== "unavailable" && !conn.lastError) return;

  // Check if any active locks remain after clearing
  const remainingActiveLocks = allLockKeys.filter(k => {
    if (keysToClear.includes(k)) return false;
    const expiry = conn[k];
    return expiry && new Date(expiry).getTime() > now;
  });

  const clearObj = Object.fromEntries(keysToClear.map(k => [k, null]));

  // Only reset error state if no active locks remain
  if (remainingActiveLocks.length === 0) {
    // errorCode must be cleared alongside the rest of the error state. Leaving
    // it behind strands a stale HTTP code (e.g. 400/429) on a connection whose
    // testStatus is back to "active" and whose lastError is null, which makes
    // the dashboard and any errorCode-based diagnostics lie about a healthy
    // account.
    Object.assign(clearObj, { testStatus: "active", lastError: null, lastErrorAt: null, errorCode: null, backoffLevel: 0 });
  }

  await updateProviderConnection(connectionId, clearObj);
}

/**
 * Extract API key from request headers
 */
export function extractApiKey(request) {
  // Check Authorization header first
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // Check Anthropic x-api-key header
  const xApiKey = request.headers.get("x-api-key");
  if (xApiKey) {
    return xApiKey;
  }

  return null;
}

/**
 * Validate API key (optional - for local use can skip)
 */
export async function isValidApiKey(apiKey) {
  if (!apiKey) return false;
  return await validateApiKey(apiKey);
}
