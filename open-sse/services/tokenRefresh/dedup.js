const REFRESH_RESULT_TTL_MS = 10_000;
const MAX_CACHE_ENTRIES = 256;
const refreshDedupCache = new Map();

function sweepExpired(nowMs) {
  for (const [key, hit] of refreshDedupCache) {
    if (!hit.promise && hit.expiresAt <= nowMs) refreshDedupCache.delete(key);
  }
}

export async function dedupRefresh(provider, oldToken, fn, log) {
  if (!oldToken) return fn();
  const key = `${provider}:${oldToken}`;
  const hit = refreshDedupCache.get(key);
  if (hit) {
    if (hit.promise) {
      log?.info?.("TOKEN_REFRESH", `Reusing in-flight refresh for ${provider}`);
      return hit.promise;
    }
    if (hit.expiresAt > Date.now()) {
      log?.info?.("TOKEN_REFRESH", `Reusing recent refresh result for ${provider}`);
      return hit.result;
    }
    refreshDedupCache.delete(key);
  }
  const promise = (async () => {
    try {
      const result = await fn();
      // Cache successes only: caching a null result turns one transient
      // refresh failure into a 10s fail-closed window that defeats
      // refreshWithRetry's retries.
      if (result) {
        if (refreshDedupCache.size >= MAX_CACHE_ENTRIES) sweepExpired(Date.now());
        refreshDedupCache.set(key, { result, expiresAt: Date.now() + REFRESH_RESULT_TTL_MS });
      }
      return result;
    } catch (err) {
      refreshDedupCache.delete(key);
      throw err;
    }
  })();
  refreshDedupCache.set(key, { promise });
  return promise;
}
