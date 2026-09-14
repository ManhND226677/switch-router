"use strict";

// Process-level liveness log for the gateway.
//
// Why this exists: on 2026-09-14 the gateway stopped recording anything between
// 06:12 and 17:59 while the server was supposedly up. Nothing in the logs said
// whether the process had died, hung, or simply received no traffic — the WAL
// was never checkpointed, which only proves it did not exit gracefully. Every
// signal was ambiguous, so the incident could not be diagnosed after the fact.
//
// A periodic line removes that ambiguity: if heartbeats stop at 06:12 and
// resume at 17:59, the process was not alive in between, full stop. It is
// emitted from custom-server.js (the process entry point) rather than from the
// Next.js app, so it runs at boot and does not depend on traffic, on the app
// router having been initialized, or on the build phase.
//
// Deliberately NOT handled here: SIGINT/SIGTERM. Registering a listener for
// those replaces Node's default terminate behaviour, so a logging-only handler
// would keep the process alive on a tray "stop" and a handler that calls
// process.exit() would pre-empt the app's own graceful-shutdown route. The
// heartbeat gap is enough to answer "was it alive?" without that risk. Crashes
// are already visible: Node prints the stack to stderr.
//
// Pure helpers are exported for unit tests; nothing here touches the DB or the
// network, so it cannot itself fail in a way that hides a problem.

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
// A typo like SWITCH_ROUTER_HEARTBEAT_MS=1 must not turn the log into a firehose.
const MIN_INTERVAL_MS = 10 * 1000;

function isHeartbeatDisabled(env = process.env) {
  return String(env.SWITCH_ROUTER_HEARTBEAT || "").trim().toLowerCase() === "off";
}

function resolveHeartbeatIntervalMs(env = process.env) {
  const raw = Number(env.SWITCH_ROUTER_HEARTBEAT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, Math.floor(raw));
}

// "45s" / "12m34s" / "2h05m" — compact, and precise enough to compare against
// log timestamps when reconstructing a gap.
function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function formatBytes(bytes) {
  const mb = Number(bytes) / (1024 * 1024);
  if (!Number.isFinite(mb)) return "?MB";
  return `${mb.toFixed(0)}MB`;
}

function isoNow(now = Date.now()) {
  return new Date(now).toISOString();
}

function buildStartLine({ pid, nodeVersion, intervalMs, now, cwd }) {
  return (
    `[heartbeat] started pid=${pid} node=${nodeVersion} interval=${formatDuration(intervalMs)} at ${isoNow(now)}` +
    (cwd ? ` cwd=${cwd}` : "") +
    " — a gap between two heartbeat lines means the process was not alive"
  );
}

function buildAliveLine({ pid, uptimeMs, rssBytes, now }) {
  return `[heartbeat] alive pid=${pid} up=${formatDuration(uptimeMs)} rss=${formatBytes(rssBytes)} at ${isoNow(now)}`;
}

function buildStopLine({ pid, now, reason }) {
  return `[heartbeat] stopped pid=${pid}${reason ? ` (${reason})` : ""} at ${isoNow(now)}`;
}

/**
 * Create the heartbeat. All side-effecting inputs are injectable so the timer
 * wiring can be unit-tested without a real clock or process.
 */
function createGatewayHeartbeat(options = {}) {
  const env = options.env || process.env;
  const log = options.log || ((line) => console.log(line));
  const now = options.now || Date.now;
  const pid = options.pid != null ? options.pid : process.pid;
  const nodeVersion = options.nodeVersion != null ? options.nodeVersion : process.version;
  const cwd = options.cwd != null ? options.cwd : process.cwd();
  const memoryUsage = options.memoryUsage || (() => process.memoryUsage());
  const uptimeMs = options.uptimeMs || (() => process.uptime() * 1000);
  const intervalMs = options.intervalMs || resolveHeartbeatIntervalMs(env);

  let timer = null;

  function tick() {
    log(buildAliveLine({ pid, uptimeMs: uptimeMs(), rssBytes: memoryUsage()?.rss, now: now() }));
  }

  function start() {
    if (timer) return false;
    if (isHeartbeatDisabled(env)) return false;
    log(buildStartLine({ pid, nodeVersion, intervalMs, now: now(), cwd }));
    timer = setInterval(tick, intervalMs);
    // Never keep the process alive on our account; the HTTP server owns that.
    if (timer.unref) timer.unref();
    return true;
  }

  function stop(reason) {
    if (!timer) return false;
    clearInterval(timer);
    timer = null;
    log(buildStopLine({ pid, now: now(), reason }));
    return true;
  }

  function isRunning() {
    return timer !== null;
  }

  return { start, stop, tick, isRunning };
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  MIN_INTERVAL_MS,
  isHeartbeatDisabled,
  resolveHeartbeatIntervalMs,
  formatDuration,
  formatBytes,
  buildStartLine,
  buildAliveLine,
  buildStopLine,
  createGatewayHeartbeat,
};
