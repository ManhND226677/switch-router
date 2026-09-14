// Cause classification for Error Analytics. Maps an upstream failure
// (HTTP status + unwrapped error message) to one actionable bucket so the
// errors page reports "what to fix" instead of a wall of raw signatures.
//
// Rules are evaluated first-match-wins: message patterns are checked in
// specificity order (context/modality before the generic 400→payload rule,
// "Model is unavailable" before payload), then status fallbacks.

export const ERROR_BUCKETS = [
  "quota",
  "context",
  "modality",
  "payload",
  "config",
  "network",
  "upstream",
  "other",
];

const MESSAGE_RULES = [
  ["context", /maximum context length|context[_ ]length|context window|too many tokens|token limit/i],
  ["modality", /text[- ]only|image.{0,30}(not supported|unsupported)|unsupported.{0,30}(image|media|audio|video)|vision.{0,30}(not|unsupported)|multimodal/i],
  ["quota", /quota|rate.?limit|too many requests|rate_limit_error|resource.{0,20}exhausted|insufficient.{0,20}(quota|credit)|throttl/i],
  ["config", /unauthorized|forbidden|api.?key|subscribe|authentication|invalid.{0,20}(key|token|credential)|permission denied|payment required|expired.{0,20}(token|key)/i],
  ["network", /timeout|timed out|econn|enotfound|econnreset|etimedout|fetch failed|network|socket|dns|aborted|unreachable/i],
  ["upstream", /no capacity|unavailable|overloaded|internal server|bad gateway|service unavailable|server error/i],
  ["payload", /invalid_request_error|invalid request|malformed|must have|messages\.\d|unexpected|parse error|validation|schema/i],
];

const STATUS_FALLBACKS = [
  ["quota", new Set([429])],
  ["config", new Set([401, 402, 403])],
  ["network", new Set([0, 408, 504])],
  ["upstream", new Set([500, 502, 503, 529])],
  ["payload", new Set([400, 422])],
];

// Classify one failure into a bucket key from ERROR_BUCKETS.
// `status` is the upstream HTTP status (null/0 when the call never completed);
// `message` is the unwrapped upstream error text ("" when absent).
export function classifyErrorBucket(status, message) {
  const text = typeof message === "string" ? message : "";
  for (const [bucket, pattern] of MESSAGE_RULES) {
    if (pattern.test(text)) return bucket;
  }
  // null/undefined status = no information → "other"; status 0 = the call never
  // got an upstream response (transport failure) and is classified via the
  // network fallback set below.
  const code = status == null ? NaN : Number(status);
  for (const [bucket, codes] of STATUS_FALLBACKS) {
    if (Number.isFinite(code) && codes.has(code)) return bucket;
  }
  return "other";
}

// Aggregate rows of {status, message} into sorted bucket counts.
// Returns [{ bucket, count, share }] (share = % of total, 1 decimal),
// highest count first; buckets with zero errors are omitted.
export function aggregateErrorBuckets(rows) {
  const counts = new Map();
  for (const row of rows) {
    const bucket = classifyErrorBucket(row.status, row.message);
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
  }
  const total = rows.length;
  return [...counts.entries()]
    .map(([bucket, count]) => ({
      bucket,
      count,
      share: total ? Math.round((count / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count);
}
