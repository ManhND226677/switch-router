// Single source of truth for how a gateway API key is stored in usage records.
//
// Gateway keys are minted as `sk-{machineId}-{keyId}-{crc8}`
// (src/shared/utils/apiKey.js), so the first 8 characters are IDENTICAL for
// every key issued on one machine. A plain `slice(0, 8)` prefix therefore
// collapses distinct keys into a single usage bucket and loses the ability to
// attribute traffic per key. Keeping the last 4 characters restores per-key
// identity while dropping the keyId segment in the middle, so the stored value
// can never be replayed against validateApiKey().
//
// Lives in its own module because three independent writers must agree on the
// exact same output: the live write path (repos/usageRepo.js), the legacy
// JSON import (migrate.js) and the 003 repair migration. If they disagreed, one
// key's stats would split across two buckets.
export const FINGERPRINT_MARKER = "***";

// True when a value has already been fingerprinted/masked.
export function isFingerprinted(key) {
  return typeof key === "string" && key.includes(FINGERPRINT_MARKER);
}

// Idempotent: fingerprinting an already-fingerprinted value returns it
// unchanged, which keeps re-writes and repeated migration runs safe.
export function fingerprintApiKey(key) {
  if (!key || typeof key !== "string") return null;
  if (isFingerprinted(key)) return key;
  if (key.length <= 8) return key.charAt(0) + FINGERPRINT_MARKER;
  const tail = key.length >= 12 ? key.slice(-4) : "";
  return key.slice(0, 8) + FINGERPRINT_MARKER + tail;
}
