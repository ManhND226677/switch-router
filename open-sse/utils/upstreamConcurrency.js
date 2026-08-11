// Lightweight in-flight upstream concurrency gauge with an OPTIONAL hard cap.
//
// Disabled by default (limit <= 0) so existing behavior is unchanged. Set
// UPSTREAM_CONCURRENCY_LIMIT to a positive integer to reject excess concurrent
// upstream requests with 429 instead of letting the egress path be overwhelmed
// (relevant for providers like grok-web that hold a long-lived
// upstream socket per request).
//
// Note: this counts requests being *initiated* (acquire before execute, release
// right after execute returns), not open sockets during long streaming. It is a
// soft guard against thundering-herd fan-out, not a precise socket cap.

function readLimit() {
  const raw = process.env.UPSTREAM_CONCURRENCY_LIMIT;
  if (raw == null || raw === "") return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const LIMIT = readLimit();
let inFlight = 0;

export function getUpstreamConcurrencyLimit() {
  return LIMIT;
}

export function getUpstreamInFlight() {
  return inFlight;
}

// Returns true if a slot was acquired; caller MUST call releaseUpstreamSlot()
// (typically via a finally block) when the upstream request is settled.
export function acquireUpstreamSlot() {
  if (LIMIT > 0 && inFlight >= LIMIT) return false;
  inFlight += 1;
  return true;
}

export function releaseUpstreamSlot() {
  if (inFlight > 0) inFlight -= 1;
}
