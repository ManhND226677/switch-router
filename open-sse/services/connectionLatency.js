// Latency tracking for the "fastest" routing strategy.
//
// Records an EWMA of TTFT (falling back to total latency for non-streaming
// requests) per connection. Held in memory on the hot path and mirrored to
// SQLite by a debounced write-behind flush, so the strategy is warm again after
// a restart instead of running on priority order until traffic re-seeds it.
// All DB touch is fail-open: if the store is unavailable this degrades to the
// previous memory-only behaviour.

const ALPHA = 0.3; // ~last 4-5 samples dominate
// Samples older than this stop influencing routing — an account that was fast
// yesterday but degraded today must not coast on stale numbers.
const FRESH_MS = 15 * 60 * 1000;
// Persisted entries older than this are dropped on hydrate (dead connections).
const PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FLUSH_DEBOUNCE_MS = 5000;
const MAX_ENTRIES = 500;

if (!global._connectionLatencyEwma) global._connectionLatencyEwma = new Map();
const store = global._connectionLatencyEwma;

let flushTimer = null;
let dirty = false;
let hydrated = false;
let hydrating = null;

// Relative import keeps the engine loadable without the app's DB layer
// resolving (same precedent as chatCore/*Handler.js → src/lib/usageDb.js).
const repo = () => import("../../src/lib/db/repos/connectionLatencyRepo.js");

/**
 * Load persisted EWMAs into memory. Idempotent and safe to await from the
 * routing path — failing only means routing starts cold.
 */
export function hydrateConnectionLatency() {
  if (hydrated) return Promise.resolve(0);
  if (!hydrating) {
    hydrating = (async () => {
      try {
        const { readLatencySnapshots } = await repo();
        const saved = await readLatencySnapshots();
        const cutoff = Date.now() - PERSIST_MAX_AGE_MS;
        let loaded = 0;
        for (const [connectionId, entry] of Object.entries(saved)) {
          if (!entry || !Number.isFinite(entry.lastSampleAt) || entry.lastSampleAt < cutoff) continue;
          if (entry.ewmaTtftMs == null && entry.ewmaTotalMs == null) continue;
          // A live sample always wins over the one restored from disk.
          if (store.has(connectionId)) continue;
          store.set(connectionId, {
            ewmaTtftMs: entry.ewmaTtftMs ?? null,
            ewmaTotalMs: entry.ewmaTotalMs ?? null,
            samples: entry.samples || 0,
            lastSampleAt: entry.lastSampleAt,
          });
          loaded++;
        }
        pruneStore();
        hydrated = true;
        return loaded;
      } catch (e) {
        console.warn(`[latency] hydrate failed, continuing memory-only: ${e?.message || e}`);
        return 0;
      } finally {
        hydrating = null;
      }
    })();
  }
  return hydrating;
}

/** Drop the oldest entries past the cap so removed connections can't pile up. */
function pruneStore() {
  if (store.size <= MAX_ENTRIES) return;
  const byAge = [...store.entries()].sort((a, b) => (a[1].lastSampleAt || 0) - (b[1].lastSampleAt || 0));
  for (const [id] of byAge.slice(0, store.size - MAX_ENTRIES)) store.delete(id);
}

/**
 * Persist the map. Fired on a debounce after samples arrive, and once more from
 * the shutdown route so a restart never loses the last few seconds.
 */
export async function flushConnectionLatency() {
  if (!dirty) return 0;
  dirty = false;
  pruneStore();
  try {
    const { writeLatencySnapshots } = await repo();
    return await writeLatencySnapshots(Object.fromEntries(store));
  } catch (e) {
    dirty = true; // retry with the next sample, or at shutdown
    console.warn(`[latency] flush failed: ${e?.message || e}`);
    return 0;
  }
}

function scheduleFlush() {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushConnectionLatency().catch(() => {});
  }, FLUSH_DEBOUNCE_MS);
  flushTimer.unref?.();
}

/**
 * Record one observed request latency for a connection.
 * @param {string} connectionId
 * @param {number|null} ttftMs time-to-first-token (null for non-streaming)
 * @param {number|null} totalMs total request latency
 */
export function recordConnectionLatency(connectionId, ttftMs, totalMs) {
  if (!connectionId || connectionId === "noauth") return;
  const ttft = Number.isFinite(ttftMs) && ttftMs > 0 ? Math.round(ttftMs) : null;
  const total = Number.isFinite(totalMs) && totalMs > 0 ? Math.round(totalMs) : null;
  // Non-streaming requests have no TTFT; their total is an upper bound of TTFT
  // and still ranks slow accounts against fast ones usefully.
  const sample = ttft ?? total;
  if (sample == null) return;

  const cur = store.get(connectionId) || { ewmaTtftMs: null, ewmaTotalMs: null, samples: 0, lastSampleAt: 0 };
  cur.ewmaTtftMs = (ttft != null)
    ? (cur.ewmaTtftMs == null ? ttft : Math.round(ALPHA * ttft + (1 - ALPHA) * cur.ewmaTtftMs))
    : cur.ewmaTtftMs;
  cur.ewmaTotalMs = (total != null)
    ? (cur.ewmaTotalMs == null ? total : Math.round(ALPHA * total + (1 - ALPHA) * cur.ewmaTotalMs))
    : cur.ewmaTotalMs;
  cur.samples += 1;
  cur.lastSampleAt = Date.now();
  store.set(connectionId, cur);
  scheduleFlush();
}

/**
 * Fresh latency snapshot for one connection, or null when there is no recent
 * sample to trust. scoreMs is the TTFT EWMA, falling back to the total-latency
 * EWMA for connections only seen on non-streaming requests (their total is an
 * upper bound of TTFT — biased slow, which only makes the account prove itself
 * once it serves a streaming request).
 */
export function getConnectionLatencySnapshot(connectionId) {
  const cur = store.get(connectionId);
  if (!cur) return null;
  if (Date.now() - cur.lastSampleAt > FRESH_MS) return null;
  const scoreMs = cur.ewmaTtftMs ?? cur.ewmaTotalMs;
  if (scoreMs == null) return null;
  return { ewmaTtftMs: cur.ewmaTtftMs, ewmaTotalMs: cur.ewmaTotalMs, scoreMs, samples: cur.samples, lastSampleAt: cur.lastSampleAt };
}

/** All snapshots (fresh + stale) — for dashboards/debugging. */
export function getAllConnectionLatencies() {
  const out = [];
  for (const [connectionId, cur] of store.entries()) {
    out.push({ connectionId, ...cur });
  }
  return out;
}

/**
 * Pick the fastest connection from an available list.
 *
 * Unsampled connections get the MEDIAN of known EWMAs (not Infinity) so a new
 * account still gets traffic and can prove itself, while a consistently slow
 * account sinks below everything unknown. With zero samples anywhere this
 * degrades to fill-first priority order.
 */
export function pickFastestConnection(availableConnections) {
  if (!availableConnections || availableConnections.length === 0) return null;

  const scored = availableConnections.map((c) => ({
    connection: c,
    ewma: getConnectionLatencySnapshot(c.id)?.scoreMs ?? null,
  }));

  const known = scored.filter((s) => s.ewma != null).map((s) => s.ewma).sort((a, b) => a - b);
  if (known.length === 0) return availableConnections[0]; // no data → priority order
  const neutral = known[Math.floor(known.length / 2)];

  scored.sort((a, b) => {
    const diff = (a.ewma ?? neutral) - (b.ewma ?? neutral);
    if (diff !== 0) return diff;
    return (a.connection.priority || 999) - (b.connection.priority || 999);
  });
  return scored[0].connection;
}
