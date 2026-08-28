// Conversation → connection affinity for the gateway.
//
// WHY: a multi-turn conversation re-sends its whole history every request, and
// Anthropic / Google / OpenAI cache that prefix PER ACCOUNT. If the router
// rotates to another account mid-conversation the prefix cache is cold again —
// slower first token and a full-price input bill. Sticky round-robin only
// smooths rotation within one strategy; this pins the CONVERSATION itself.
//
// The key is a hash of the model plus the first two messages, which stays
// identical for every turn of the same conversation and changes when a new one
// starts. Purely in-memory on purpose: affinity only matters while a
// conversation is active, and a restart losing it costs one cold request.
import { createHash } from "node:crypto";

const PIN_TTL_MS = 15 * 60 * 1000;
const MAX_PINS = 2000;

if (!global._sessionPins) global._sessionPins = new Map();
const pins = global._sessionPins; // sessionKey -> { connectionId, lastSeenAt }

function asText(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? "");
  } catch {
    return "";
  }
}

/**
 * Stable conversation key, or null when there is nothing to keep warm yet
 * (no messages, or a lone message with no conversation to continue).
 */
export function sessionPinKey(model, messages) {
  if (!Array.isArray(messages) || messages.length < 2) return null;
  const head = messages.slice(0, 2)
    .map((m) => `${m?.role}:${asText(m?.content).slice(0, 2000)}`)
    .join("\n");
  return createHash("sha1").update(`${model}\n${head}`).digest("hex").slice(0, 16);
}

export function getPinnedConnection(sessionKey) {
  if (!sessionKey) return null;
  const entry = pins.get(sessionKey);
  if (!entry) return null;
  if (Date.now() - entry.lastSeenAt > PIN_TTL_MS) {
    pins.delete(sessionKey);
    return null;
  }
  // Touch so live conversations survive eviction.
  entry.lastSeenAt = Date.now();
  return entry.connectionId;
}

export function pinSession(sessionKey, connectionId) {
  if (!sessionKey || !connectionId || connectionId === "noauth") return;
  pins.set(sessionKey, { connectionId, lastSeenAt: Date.now() });
  if (pins.size <= MAX_PINS) return;
  const stale = [...pins.entries()].sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
  for (const [key] of stale.slice(0, pins.size - MAX_PINS)) pins.delete(key);
}

/** Observability: how many conversations are currently pinned where. */
export function getSessionPinStats() {
  const now = Date.now();
  const byConnection = {};
  let active = 0;
  for (const entry of pins.values()) {
    if (now - entry.lastSeenAt > PIN_TTL_MS) continue;
    active++;
    byConnection[entry.connectionId] = (byConnection[entry.connectionId] || 0) + 1;
  }
  return { active, ttlMs: PIN_TTL_MS, byConnection };
}

export function clearSessionPins() {
  pins.clear();
}
