// OpenAI-compatible error types mapping (client-facing)
export const ERROR_TYPES = {
  400: { type: "invalid_request_error", code: "bad_request" },
  401: { type: "authentication_error", code: "invalid_api_key" },
  402: { type: "billing_error", code: "payment_required" },
  403: { type: "permission_error", code: "insufficient_quota" },
  404: { type: "invalid_request_error", code: "model_not_found" },
  406: { type: "invalid_request_error", code: "model_not_supported" },
  429: { type: "rate_limit_error", code: "rate_limit_exceeded" },
  500: { type: "server_error", code: "internal_server_error" },
  502: { type: "server_error", code: "bad_gateway" },
  503: { type: "server_error", code: "service_unavailable" },
  504: { type: "server_error", code: "gateway_timeout" }
};

// Default error messages per status code (client-facing)
export const DEFAULT_ERROR_MESSAGES = {
  400: "Bad request",
  401: "Invalid API key provided",
  402: "Payment required",
  403: "You exceeded your current quota",
  404: "Model not found",
  406: "Model not supported",
  429: "Rate limit exceeded",
  500: "Internal server error",
  502: "Bad gateway - upstream provider error",
  503: "Service temporarily unavailable",
  504: "Gateway timeout"
};

// Exponential backoff config for rate limits
export const BACKOFF_CONFIG = {
  base: 2000,
  max: 5 * 60 * 1000,
  maxLevel: 15
};

// Default cooldown for transient/unknown errors
export const TRANSIENT_COOLDOWN_MS = 30 * 1000;

// Hard cap for provider-reported rate limit cooldown (e.g. codex resets_at can be 5-6h)
export const MAX_RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000;

// Cooldown durations (ms)
const COOLDOWN = {
  long: 2 * 60 * 1000,
  short: 5 * 1000,
};

/**
 * Context-window overflow signatures (lowercased substrings).
 *
 * These arrive inside arbitrarily nested JSON strings (StepFun double-encodes
 * `error.message` three levels deep), which is fine for substring matching:
 * escaping only backslashes the quotes, never the words themselves.
 *
 * The payload is at fault, not the account — every other account behind the
 * SAME model has the same token window, so rotating cannot produce a
 * different outcome. See `payloadFault` below.
 */
export const CONTEXT_OVERFLOW_TEXTS = [
  "context_length_exceeded",
  "maximum context length",
  "prompt is too long",
  "please reduce the length",
  "exceeds the maximum number of tokens",
  "input token count",
  "context window exceeded",
];

/**
 * Unified error classification rules.
 * Checked top-to-bottom: text rules first (by order), then status rules.
 * Each rule: { text?, status?, cooldownMs?, backoff?, payloadFault? }
 *   - text: substring match (case-insensitive) on error message
 *   - status: HTTP status code match
 *   - cooldownMs: fixed cooldown duration
 *   - backoff: true = use exponential backoff (rate limit)
 *   - payloadFault: true = the request body itself is rejected. Never cool an
 *     account down and never rotate accounts for it (the next account sits
 *     behind the same model window). Combo model rotation still proceeds,
 *     because a later model may accept the payload.
 */
export const ERROR_RULES = [
  // --- Text-based rules (checked first, order = priority) ---
  { text: "no credentials",           cooldownMs: COOLDOWN.long },
  { text: "request not allowed",      cooldownMs: COOLDOWN.short },
  // Anthropic's wording for its own 400. The payload is at fault, not the
  // account, so it must not cool any account down.
  { text: "improperly formed request", cooldownMs: 0 },
  { text: "rate limit",               backoff: true },
  { text: "too many requests",        backoff: true },
  { text: "quota exceeded",           backoff: true },
  { text: "capacity",                 backoff: true },
  { text: "overloaded",               backoff: true },

  // Context overflow sits BELOW the rate-limit texts on purpose: a 429 that
  // happens to mention tokens must still cool down and rotate, or the payload
  // guard would silently cost the user its account failover.
  ...CONTEXT_OVERFLOW_TEXTS.map(text => ({ text, cooldownMs: 0, payloadFault: true })),

  // WorkBuddy AI's client gate (400 code 11128): it rejects the body for carrying a
  // disallowed CLI identity, so every sibling account behind the same model gets the
  // same verdict — rotating only burns upstream calls and mislabels healthy accounts.
  { text: "illegal api invocation from an unapproved channel", cooldownMs: 0, payloadFault: true },

  // WorkBuddy AI 403 code 11140 "request illegal" is a per-account credential
  // rejection, so rotation stays on. But a dead credential (revoked desktop
  // session, needs re-OAuth) fails EVERY request: the old fixed 2-minute
  // cooldown re-burned an upstream call every 2 minutes forever. Escalate like
  // quota errors instead — backoffLevel resets on the next success, so a
  // re-OAuthed account recovers automatically.
  { text: '"code":11140', backoff: true },

  // --- Status-based rules (fallback when text doesn't match) ---
  { status: 401, cooldownMs: COOLDOWN.long },
  { status: 402, cooldownMs: COOLDOWN.long },
  { status: 403, cooldownMs: COOLDOWN.long },
  { status: 404, cooldownMs: COOLDOWN.long },
  { status: 429, backoff: true },

  // --- Deterministic client errors (cooldownMs 0 = never lock the account) ---
  // Retrying these against another account of the SAME model cannot help,
  // but rotation must stay enabled so a combo still falls through to its next
  // model, and so the originating status reaches the client.
  { status: 400, cooldownMs: 0 },
  { status: 406, cooldownMs: 0 },
  // 413 is a size cap on the payload itself, so it gets the same
  // never-cool-the-account treatment as the overflow texts above.
  { status: 413, cooldownMs: 0, payloadFault: true },
  { status: 422, cooldownMs: 0 },
];

// Backward compat: COOLDOWN_MS object (used by index.js re-export)
export const COOLDOWN_MS = {
  unauthorized: COOLDOWN.long,
  paymentRequired: COOLDOWN.long,
  notFound: COOLDOWN.long,
  transient: TRANSIENT_COOLDOWN_MS,
  requestNotAllowed: COOLDOWN.short,
};
