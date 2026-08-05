// Match a configured CLI base URL against the local Switch-Router endpoint.
const stripTrailingSlash = (s) => (s || "").replace(/\/+$/, "");

export function matchKnownEndpoint(currentUrl, opts = {}) {
  if (!currentUrl) return false;
  const url = stripTrailingSlash(currentUrl);
  void opts;
  return /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url);
}
