// WorkBuddy daily check-in auto-claim scheduler.
//
// WorkBuddy runs check-in as seasonal campaigns: POST /billing/meter/checkin-status
// exposes the current season (active, daily_credit, today_checked_in, streak) and
// POST /billing/meter/daily-checkin claims the day's credits. Both consume the chat
// session token directly. With no season running the claim answers 400 code 10001
// "签到活动未开启或已过期", so the scheduler keeps polling cheaply and claims the
// moment a season goes live — the point is that the user never has to remember it.
//
// Mirrors quotaAutoPing's shape: injected deps for tests, global singleton state to
// survive HMR, unref'd timers, and a stop() hook wired into the shutdown route.
import { getProviderConnections } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "@/app/api/usage/[connectionId]/route.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { resolveWorkbuddySession } from "open-sse/executors/workbuddy.js";
import {
  WORKBUDDY_CHECKIN_STATUS_URL,
  WORKBUDDY_CHECKIN_CLAIM_URL,
} from "open-sse/config/appConstants.js";

// Tick cadence is short so the day's claim happens within ~30min of midnight
// once a season is live; the per-connection idle throttle keeps the real
// upstream load at a handful of status calls per day per connection.
const TICK_INTERVAL_MS = 30 * 60 * 1000;
const FIRST_TICK_DELAY_MS = 5 * 1000;
// While a connection's season is closed (or already checked in) there is
// nothing to claim — re-read status at most this often.
const IDLE_STATUS_INTERVAL_MS = 4 * 60 * 60 * 1000;

const g = (global.__workbuddyAutoCheckin ??= {
  interval: null,
  firstTickTimer: null,
  running: false,
  connections: {},
});

// Opt-out switch for the personal runtime; default is on because the feature
// exists purely to claim the user's own rewards.
function isDisabled() {
  return String(process.env.WORKBUDDY_AUTO_CHECKIN || "").trim().toLowerCase() === "off";
}

function canStart() {
  return typeof window === "undefined"
    && process.env.NEXT_PHASE !== "phase-production-build"
    && !process.env.VITEST
    && !isDisabled();
}

function buildProxyOptions(cfg) {
  return {
    connectionProxyEnabled: cfg?.connectionProxyEnabled === true,
    connectionProxyUrl: cfg?.connectionProxyUrl || "",
    connectionNoProxy: cfg?.connectionNoProxy || "",
    strictProxy: false,
  };
}

async function postJson(deps, token, url, proxyOptions) {
  const response = await deps.proxyAwareFetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: "{}",
    signal: AbortSignal.timeout(10000),
  }, proxyOptions);
  const data = await response.json().catch(() => null);
  return { ok: response.ok === true, httpStatus: response.status, data };
}

// Merge patch into the previous snapshot; console.log only on state transitions
// so a 30-min tick never spams the log with the same "inactive" line.
function nextSnapshot(prev, patch, log = null) {
  const next = {
    connectionId: prev.connectionId,
    name: prev.name,
    status: prev.status || "unknown",
    seasonActive: prev.seasonActive || false,
    todayCheckedIn: prev.todayCheckedIn || false,
    streakDays: prev.streakDays || 0,
    dailyCredit: prev.dailyCredit || 0,
    seasonStart: prev.seasonStart || "",
    seasonEnd: prev.seasonEnd || "",
    lastStatusAt: prev.lastStatusAt || null,
    lastClaimAt: prev.lastClaimAt || null,
    lastClaimCredit: prev.lastClaimCredit ?? null,
    lastError: prev.lastError || null,
    needClaim: prev.needClaim || false,
    lastLogKey: prev.lastLogKey || null,
    ...patch,
  };
  if (log && (!log.logKey || log.logKey !== prev.lastLogKey)) {
    console.log(log.text ?? log.logKey);
    next.lastLogKey = log.logKey ?? next.status;
  }
  return next;
}

async function checkinConnection(conn, deps, state) {
  const now = Date.now();
  const prev = state.connections[conn.id] || { connectionId: conn.id, name: conn.email || conn.name || conn.id };
  const label = conn.email || conn.name || conn.id.slice(0, 8);
  const session = resolveWorkbuddySession(conn);
  if (!session?.accessToken) {
    return nextSnapshot(prev, { status: "no_session", needClaim: false }, {
      logKey: "no_session",
      text: `[WorkBuddyCheckin] ${label}: no session, skipped`,
    });
  }

  // Idle throttle: skip upstream entirely while there is nothing to claim and
  // the last status read is fresh.
  const idle = prev.lastStatusAt
    && !prev.needClaim
    && !prev.lastError
    && now - prev.lastStatusAt < IDLE_STATUS_INTERVAL_MS;
  if (idle) return { ...prev, connectionId: conn.id };

  const proxyOptions = buildProxyOptions(await deps.resolveConnectionProxyConfig(conn.providerSpecificData));
  let status = await postJson(deps, session.accessToken, WORKBUDDY_CHECKIN_STATUS_URL, proxyOptions);

  // A stale desktop/web session (401/403) is refreshed the same way the chat
  // path does, then the status read is retried once with the fresh token.
  if (!status.ok && (status.httpStatus === 401 || status.httpStatus === 403)) {
    try {
      const refreshed = await deps.refreshAndUpdateCredentials(conn, false, proxyOptions);
      const fresh = refreshed?.connection ? resolveWorkbuddySession(refreshed.connection) : null;
      if (fresh?.accessToken) {
        status = await postJson(deps, fresh.accessToken, WORKBUDDY_CHECKIN_STATUS_URL, proxyOptions);
      }
    } catch { /* fall through with the original failure */ }
  }

  if (!status.ok) {
    const code = status.data?.code;
    const detail = code != null ? `code ${code}` : `HTTP ${status.httpStatus}`;
    return nextSnapshot(prev, {
      status: "unavailable",
      lastStatusAt: now,
      lastError: detail,
      needClaim: false,
    }, {
      logKey: `unavailable:${detail}`,
      text: `[WorkBuddyCheckin] ${label}: status unavailable (${detail})`,
    });
  }

  const data = status.data?.data || {};
  const info = {
    status: "idle",
    seasonActive: data.active === true,
    todayCheckedIn: data.today_checked_in === true,
    streakDays: Number(data.streak_days) || 0,
    dailyCredit: Number(data.daily_credit) || 0,
    seasonStart: data.start_time || "",
    seasonEnd: data.end_time || "",
    lastStatusAt: now,
    lastError: null,
  };

  if (!info.seasonActive) {
    return nextSnapshot(prev, { ...info, status: "inactive", needClaim: false }, {
      logKey: "inactive",
      text: `[WorkBuddyCheckin] ${label}: season inactive, nothing to claim`,
    });
  }
  if (info.todayCheckedIn) {
    return nextSnapshot(prev, { ...info, status: "checked_in", needClaim: false }, {
      logKey: "checked_in",
      text: `[WorkBuddyCheckin] ${label}: already checked in today (streak ${info.streakDays})`,
    });
  }

  const claim = await postJson(deps, session.accessToken, WORKBUDDY_CHECKIN_CLAIM_URL, proxyOptions);
  if (!claim.ok) {
    const code = claim.data?.code ?? claim.httpStatus;
    return nextSnapshot(prev, {
      ...info,
      status: "claim_failed",
      needClaim: true,
      lastClaimResult: { code, msg: String(claim.data?.msg || claim.httpStatus) },
    }, {
      logKey: `claim_failed:${code}`,
      text: `[WorkBuddyCheckin] ${label}: claim failed (code ${code}: ${claim.data?.msg || claim.httpStatus})`,
    });
  }

  const claimedCredit = Number(claim.data?.data?.credit ?? claim.data?.data?.daily_credit ?? 0) || 0;
  return nextSnapshot(prev, {
    ...info,
    todayCheckedIn: true,
    needClaim: false,
    status: "claimed",
    lastClaimAt: new Date().toISOString(),
    lastClaimCredit: claimedCredit,
  }, {
    logKey: "claimed",
    text: `[WorkBuddyCheckin] ${label}: claimed ${claimedCredit} credit (streak ${info.streakDays + 1})`,
  });
}

export async function runWorkbuddyAutoCheckinTick(deps = createDefaultDeps(), state = g) {
  if (state.running) return state;
  state.running = true;
  try {
    const conns = await deps.getProviderConnections({ provider: "workbuddy", isActive: true });
    for (const conn of conns) {
      try {
        state.connections[conn.id] = await checkinConnection(conn, deps, state);
      } catch (e) {
        const prev = state.connections[conn.id] || { connectionId: conn.id, name: conn.email || conn.name || conn.id };
        state.connections[conn.id] = nextSnapshot(prev, {
          status: "unavailable",
          lastError: e.message,
          lastStatusAt: Date.now(),
        });
        console.warn(`[WorkBuddyCheckin] ${conn.email || conn.id}: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn("[WorkBuddyCheckin] tick error:", e.message);
  } finally {
    state.running = false;
  }
  return state;
}

function createDefaultDeps() {
  return {
    getProviderConnections,
    resolveConnectionProxyConfig,
    refreshAndUpdateCredentials,
    proxyAwareFetch,
  };
}

export function ensureWorkbuddyAutoCheckinStarted() {
  if (g.interval || g.firstTickTimer || !canStart()) return false;
  console.log("[WorkBuddyCheckin] scheduler started (tick every 30m)");
  g.firstTickTimer = setTimeout(() => {
    g.firstTickTimer = null;
    runWorkbuddyAutoCheckinTick().catch(() => {});
  }, FIRST_TICK_DELAY_MS);
  if (g.firstTickTimer.unref) g.firstTickTimer.unref();
  g.interval = setInterval(() => { runWorkbuddyAutoCheckinTick().catch(() => {}); }, TICK_INTERVAL_MS);
  if (g.interval.unref) g.interval.unref();
  return true;
}

export function stopWorkbuddyAutoCheckin() {
  if (g.firstTickTimer) {
    clearTimeout(g.firstTickTimer);
    g.firstTickTimer = null;
  }
  if (!g.interval) return;
  clearInterval(g.interval);
  g.interval = null;
  console.log("[WorkBuddyCheckin] scheduler stopped");
}

// Last known check-in state for the usage API (null before the first tick).
export function getWorkbuddyCheckinSnapshot(connectionId) {
  return g.connections[connectionId] || null;
}
