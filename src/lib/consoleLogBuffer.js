import { EventEmitter } from "events";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config.js";

const consoleLevels = ["log", "info", "warn", "error", "debug"];
const FLUSH_INTERVAL_MS = 100;
const MAX_BATCH_LINES = 50;

if (!global._consoleLogBufferState) {
  global._consoleLogBufferState = {
    ring: null,
    pendingLines: [],
    patched: false,
    originals: {},
    emitter: new EventEmitter(),
    sequence: 0,
    flushTimer: null,
  };
  global._consoleLogBufferState.emitter.setMaxListeners(100);
}

const state = global._consoleLogBufferState;

// Ensure emitter/ring state exists after a Next.js hot reload with a stale
// global object from an older module version.
if (!state.emitter) {
  state.emitter = new EventEmitter();
  state.emitter.setMaxListeners(100);
}
if (!Array.isArray(state.pendingLines)) state.pendingLines = [];
if (!Object.prototype.hasOwnProperty.call(state, "sequence")) state.sequence = 0;
if (!Object.prototype.hasOwnProperty.call(state, "flushTimer")) state.flushTimer = null;

function getMaxLines() {
  return Math.max(1, Number(CONSOLE_LOG_CONFIG.maxLines) || 1);
}

function ensureRing() {
  const capacity = getMaxLines();
  if (state.ring && state.ring.capacity === capacity) return state.ring;

  const previous = state.ring ? getRingSnapshot(state.ring) : (Array.isArray(state.logs) ? state.logs : []);
  const items = previous.slice(-capacity);
  state.ring = {
    capacity,
    items,
    start: 0,
    size: items.length,
  };
  return state.ring;
}

function getRingSnapshot(ring = ensureRing()) {
  const result = new Array(ring.size);
  for (let i = 0; i < ring.size; i++) {
    result[i] = ring.items[(ring.start + i) % ring.capacity];
  }
  return result;
}

function appendToRing(line) {
  const ring = ensureRing();
  if (ring.size < ring.capacity) {
    ring.items[(ring.start + ring.size) % ring.capacity] = line;
    ring.size += 1;
    return;
  }

  ring.items[ring.start] = line;
  ring.start = (ring.start + 1) % ring.capacity;
}

function flushPendingLines() {
  state.flushTimer = null;
  if (!state.pendingLines.length) return;

  const lines = state.pendingLines.splice(0, state.pendingLines.length);
  state.emitter.emit("lines", lines);
}

function scheduleFlush() {
  if (state.flushTimer) return;
  state.flushTimer = setTimeout(flushPendingLines, FLUSH_INTERVAL_MS);
  state.flushTimer?.unref?.();
}

function toLogLine(level, args) {
  // Keep level in the signature for compatibility with the capture wrapper;
  // the existing console UI intentionally renders the formatted line only.
  void level;
  return args.map(formatArg).join(" ");
}

// Strip ANSI escape codes so terminal colors don't bleed into UI
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(str) {
  return str.replace(ANSI_RE, "");
}

function formatArg(arg) {
  if (typeof arg === "string") return stripAnsi(arg);
  if (arg instanceof Error) return stripAnsi(arg.stack || arg.message || String(arg));
  try {
    return stripAnsi(JSON.stringify(arg));
  } catch {
    return stripAnsi(String(arg));
  }
}

function appendLine(line) {
  appendToRing(line);
  state.sequence += 1;
  state.pendingLines.push(line);

  if (state.pendingLines.length >= MAX_BATCH_LINES) {
    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
    flushPendingLines();
  } else {
    scheduleFlush();
  }
}

export function initConsoleLogCapture() {
  if (state.patched) return;

  for (const level of consoleLevels) {
    state.originals[level] = console[level];
    console[level] = (...args) => {
      appendLine(toLogLine(level, args));
      state.originals[level](...args);
    };
  }

  state.patched = true;
}

export function getConsoleLogs() {
  return getRingSnapshot();
}

export function getConsoleSnapshot() {
  return {
    logs: getRingSnapshot(),
    sequence: state.sequence,
  };
}

export function clearConsoleLogs() {
  if (state.flushTimer) {
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }
  state.pendingLines.splice(0, state.pendingLines.length);

  const ring = ensureRing();
  ring.items = [];
  ring.start = 0;
  ring.size = 0;
  state.logs = [];
  state.sequence += 1;
  state.emitter.emit("clear");
}

export function getConsoleEmitter() {
  return state.emitter;
}
