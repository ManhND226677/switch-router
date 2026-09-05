// Background health prober — the "half-open" half of a circuit breaker.
//
// Availability today is passive: an account is only discovered dead when a
// REAL request fails, and after its cooldown expires the next real request is
// again the guinea pig. This prober flips recovery to active: shortly before a
// model lock expires it sends a tiny x-9r-probe ping pinned to that exact
// connection. A success flows through the normal pipeline (probe flag = one
// account, no retry cascade) and its onRequestSuccess → clearAccountError
// restores the account BEFORE user traffic hits it. A failure records history
// and leaves the lock to expire on its own (probes never extend locks).
//
// Off by default (probes spend real quota): enable with settings.healthProberEnabled.

import { getProviderConnections, getSettings } from "@/lib/localDb";
import { pingModelByKind } from "@/app/api/models/test/ping";
import { MODEL_LOCK_PREFIX } from "open-sse/services/accountFallback.js";
import { clearAccountError } from "./auth.js";
import * as log from "../utils/logger.js";

// Probe locks expiring within this window (half-open just before cooldown end).
const PROBE_LEAD_MS = 2 * 60 * 1000;
// How often we look for new probe targets. Sweeps run sequentially and skip
// ticks while a previous sweep (with its 30–90s pings) is still in flight.
const SWEEP_INTERVAL_MS = 30 * 1000;
const HISTORY_PER_CONNECTION = 20;

if (!global._healthProberState) {
  global._healthProberState = {
    timer: null,
    sweeping: false,
    lastSweepAt: 0,
    lastTargetCount: 0,
    history: new Map(), // connectionId -> [{ ts, model, ok, latencyMs, error }]
  };
}
const proberState = global._healthProberState;

export function getHealthProberStatus() {
  return {
    running: proberState.timer != null,
    sweeping: proberState.sweeping,
    lastSweepAt: proberState.lastSweepAt || null,
    lastTargetCount: proberState.lastTargetCount,
    history: [...proberState.history.entries()].map(([connectionId, entries]) => ({
      connectionId,
      entries,
    })),
  };
}

function recordProbeResult(connectionId, entry) {
  const list = proberState.history.get(connectionId) || [];
  list.unshift(entry);
  if (list.length > HISTORY_PER_CONNECTION) list.length = HISTORY_PER_CONNECTION;
  proberState.history.set(connectionId, list);
}

async function probeOne(conn, model) {
  const connName = conn.displayName || conn.name || conn.email || conn.id?.slice(0, 8);
  try {
    const { ok, latencyMs, error } = await pingModelByKind(model, "llm", undefined, { connectionId: conn.id });
    recordProbeResult(conn.id, {
      ts: new Date().toISOString(),
      model,
      ok,
      latencyMs,
      error: error || null,
    });
    // Success: the pipeline's onRequestSuccess already cleared the model lock
    // (half-open → closed). Failure: lock simply expires on schedule.
    if (ok) {
      log.info("PROBE", `✓ ${connName} recovered on ${model} (${latencyMs}ms) — lock cleared before user traffic`);
      try {
        await clearAccountError(conn.id, conn, model);
      } catch (clearErr) {
        log.warn("PROBE", `clearAccountError failed for ${connName}: ${clearErr?.message || clearErr}`);
      }
    } else {
      log.warn("PROBE", `✗ ${connName} still failing on ${model}: ${String(error || "").slice(0, 120)}`);
    }
  } catch (err) {
    recordProbeResult(conn.id, { ts: new Date().toISOString(), model, ok: false, latencyMs: null, error: err?.message || String(err) });
  }
}

export async function sweepHealthProber() {
  if (proberState.sweeping) return;
  proberState.sweeping = true;
  try {
    const settings = await getSettings();
    if (!settings.healthProberEnabled) return;

    const connections = await getProviderConnections({ isActive: true });
    const now = Date.now();
    const targets = [];
    for (const conn of connections) {
      if (!conn.id || conn.id === "noauth") continue;
      for (const [key, expiry] of Object.entries(conn)) {
        if (!key.startsWith(MODEL_LOCK_PREFIX)) continue;
        const ms = new Date(expiry).getTime();
        if (!Number.isFinite(ms) || ms <= now) continue;
        const model = key.slice(MODEL_LOCK_PREFIX.length);
        // "__all" is an account-level lock with no pingable model — let it expire.
        if (model === "__all") continue;
        if (ms - now <= PROBE_LEAD_MS) targets.push({ conn, model });
      }
    }

    proberState.lastSweepAt = now;
    proberState.lastTargetCount = targets.length;
    if (targets.length === 0) return;

    log.debug?.("PROBE", `half-open sweep: ${targets.length} target(s)`);
    // Sequential: a burst of parallel pings would spike upstream load and
    // trip the very rate limits we're recovering from.
    for (const t of targets) {
      await probeOne(t.conn, t.model);
    }
  } catch (err) {
    log.warn?.("PROBE", `sweep failed: ${err?.message || err}`);
  } finally {
    proberState.sweeping = false;
  }
}

export function ensureHealthProberStarted() {
  if (proberState.timer) return;
  proberState.timer = setInterval(() => {
    sweepHealthProber().catch(() => {});
  }, SWEEP_INTERVAL_MS);
  proberState.timer.unref?.();
}
