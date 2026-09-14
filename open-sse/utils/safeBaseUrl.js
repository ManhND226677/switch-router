// Guard for user-supplied base URLs before they reach fetch().
// The gateway is local-only, but a malicious provider key / dashboard call can
// still point the server at internal ranges (169.254.169.254 metadata, etc.).
// Accepts only http(s), rejects loopback/private/link-local IP literals and
// local hostnames. NOTE: DNS-rebinding is not prevented (hostnames are not
// resolved here) — this blocks the direct-literal attacks and non-http schemes.

const HTTP_PROTOCOLS = /^https?:$/;

const PRIVATE_IPV4 = /^(127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/;
const PRIVATE_IPV6 = /^(::1|::|fc|fd|fe80:|fe[0-9a-f]{2}:)/i;
const LOCAL_HOSTNAMES = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home\.arpa)$/i;

export function isUnsafeUrlHost(hostname) {
  if (!hostname) return true;
  const host = String(hostname).replace(/^\[|\]$/g, "").toLowerCase();
  if (LOCAL_HOSTNAMES.test(host)) return true;
  if (host.includes(":")) return PRIVATE_IPV6.test(host);
  return PRIVATE_IPV4.test(host);
}

/**
 * Validate a user-supplied base URL.
 * @returns {{ ok: true, url: URL } | { ok: false, error: string }}
 */
export function validateSafeBaseUrl(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return { ok: false, error: "Base URL is required" };
  let url;
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    return { ok: false, error: "Base URL is not a valid URL" };
  }
  if (!HTTP_PROTOCOLS.test(url.protocol)) {
    return { ok: false, error: "Base URL must use http or https" };
  }
  if (isUnsafeUrlHost(url.hostname)) {
    return { ok: false, error: "Base URL must point to a public host" };
  }
  return { ok: true, url };
}
