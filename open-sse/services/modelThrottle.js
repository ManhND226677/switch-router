// Model-level backpressure for quota errors (429).
//
// Connection-level modelLock_* (accountFallback.js) cools a single account for
// seconds-to-minutes, but a model that keeps returning 429 across retries or
// across accounts stays "available" between short locks, so traffic keeps
// feeding it (observed: one provider/model collecting dozens of 429s per day).
// This registry tracks rate-limit failures per provider/model in a sliding
// window; past a threshold the model is marked HOT and combo rotation stops
// serving it until the cooldown (or a provider-reported Retry-After) lapses.
// Direct single-model requests are deliberately unaffected — an explicit
// client target keeps its current semantics.
//
// In-memory only (fail-open, zero DB traffic): losing throttle state on
// restart just costs one extra probe per hot model.

const WINDOW_MS = 5 * 60 * 1000;      // sliding window for rate-limit hits
const THRESHOLD = 3;                  // hits within window → throttle
const BASE_COOLDOWN_MS = 60 * 1000;   // first throttle: 1 min
const ESCALATION_FACTOR = 4;          // 1m → 4m → 16m ...
const MAX_COOLDOWN_MS = 30 * 60 * 1000;
const HOT_LEVEL_DECAY_MS = 30 * 60 * 1000; // clean this long → escalation resets

if (!globalThis._modelThrottleState) globalThis._modelThrottleState = new Map();
const state = globalThis._modelThrottleState;

// Injectable clock for tests; production always uses Date.now().
let clock = () => Date.now();
export function _setClock(fn) { clock = fn || (() => Date.now()); }

export function throttleKey(provider, model) {
  return `${provider || "?"}/${model || "?"}`;
}

function getEntry(key, now) {
  let entry = state.get(key);
  if (!entry) {
    entry = { hits: [], throttledUntil: 0, hotLevel: 0, lastThrottledAt: 0, reason: "" };
    state.set(key, entry);
  }
  // Escalation decays after a long clean stretch so a briefly-flaky hour last
  // week does not permanently raise the cooldown.
  if (entry.hotLevel > 0 && entry.lastThrottledAt > 0 && now - entry.lastThrottledAt > HOT_LEVEL_DECAY_MS) {
    entry.hotLevel = 0;
  }
  entry.hits = entry.hits.filter((ts) => now - ts < WINDOW_MS);
  return entry;
}

/**
 * Record one rate-limited failure for provider/model.
 * `retryAfterMs` (optional) is honored as a floor for the throttle window —
 * providers that tell us when quota resets beat our own estimate.
 * Returns the post-record throttle state (see getModelThrottle).
 */
export function recordModelRateLimit(provider, model, { retryAfterMs = null, reason = "" } = {}) {
  try {
    const now = clock();
    const entry = getEntry(throttleKey(provider, model), now);

    if (entry.throttledUntil > now) {
      // Already throttled: a fresh 429 only extends via Retry-After.
      if (retryAfterMs > 0) {
        entry.throttledUntil = Math.max(entry.throttledUntil, now + retryAfterMs);
      }
      return getModelThrottle(provider, model);
    }

    entry.hits.push(now);
    if (entry.hits.length < THRESHOLD) return getModelThrottle(provider, model);

    // Threshold crossed → throttle. Repeat offenders escalate; first-time
    // (or fully decayed) models start at level 1.
    const wasRecentlyThrottled = entry.lastThrottledAt > 0 && now - entry.lastThrottledAt <= HOT_LEVEL_DECAY_MS;
    entry.hotLevel = wasRecentlyThrottled ? Math.min(entry.hotLevel + 1, 10) : 1;
    const cooldown = Math.min(BASE_COOLDOWN_MS * Math.pow(ESCALATION_FACTOR, entry.hotLevel - 1), MAX_COOLDOWN_MS);
    entry.throttledUntil = Math.max(now + cooldown, retryAfterMs > 0 ? now + retryAfterMs : 0);
    entry.lastThrottledAt = now;
    entry.reason = reason || "";
    entry.hits = []; // restart the window after throttling
    return getModelThrottle(provider, model);
  } catch {
    return { throttled: false, untilMs: 0, remainingMs: 0, hotLevel: 0 };
  }
}

/**
 * Current throttle state for provider/model.
 * @returns {{ throttled: boolean, untilMs: number, remainingMs: number, hotLevel: number, reason: string }}
 */
export function getModelThrottle(provider, model) {
  try {
    const entry = state.get(throttleKey(provider, model));
    const now = clock();
    if (!entry) return { throttled: false, untilMs: 0, remainingMs: 0, hotLevel: 0, reason: "" };
    const throttled = entry.throttledUntil > now;
    return {
      throttled,
      untilMs: throttled ? entry.throttledUntil : 0,
      remainingMs: throttled ? entry.throttledUntil - now : 0,
      hotLevel: entry.hotLevel,
      reason: entry.reason || "",
    };
  } catch {
    return { throttled: false, untilMs: 0, remainingMs: 0, hotLevel: 0, reason: "" };
  }
}

/**
 * Success proves the model is serving again — clear its throttle and
 * escalation so it rejoins rotation immediately.
 */
export function clearModelThrottle(provider, model) {
  try {
    state.delete(throttleKey(provider, model));
  } catch { /* fail-open */ }
}

/**
 * Split "provider/model" strings into ready vs throttled, preserving order
 * within each group (stable partition, nothing dropped).
 * @returns {{ ready: string[], throttled: Array<{ model: string, untilMs: number }> }}
 */
export function partitionThrottledModels(models) {
  const ready = [];
  const throttled = [];
  if (!Array.isArray(models)) return { ready, throttled };
  try {
    for (const m of models) {
      if (typeof m !== "string") { ready.push(m); continue; }
      const slash = m.indexOf("/");
      if (slash <= 0) { ready.push(m); continue; }
      const t = getModelThrottle(m.slice(0, slash), m.slice(slash + 1));
      if (t.throttled) throttled.push({ model: m, untilMs: t.untilMs });
      else ready.push(m);
    }
  } catch {
    return { ready: Array.isArray(models) ? [...models] : [], throttled: [] };
  }
  return { ready, throttled };
}

/** Test-only: drop all throttle state. */
export function _resetModelThrottleForTests() {
  state.clear();
}
