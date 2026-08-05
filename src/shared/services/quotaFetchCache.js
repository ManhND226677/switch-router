const DEFAULT_MAX_AGE_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 512;

if (!global.__quotaFetchCache) {
  global.__quotaFetchCache = {
    entries: new Map(),
  };
}

const state = global.__quotaFetchCache;

export function invalidateQuotaFetchCache(prefix = "") {
  if (!prefix) {
    state.entries.clear();
    return;
  }
  for (const key of state.entries.keys()) {
    if (key.startsWith(prefix)) state.entries.delete(key);
  }
}

export function getQuotaFetchCacheKey(connection) {
  const version = connection?.updatedAt
    || connection?.lastRefreshAt
    || connection?.expiresAt
    || connection?.tokenExpiresAt
    || "0";
  return `quota:${connection?.id || "unknown"}:${version}`;
}

export async function getCachedQuotaUsage(key, loader, options = {}) {
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const force = options.force === true;
  const now = Date.now();
  const current = state.entries.get(key);

  if (!force && current?.value !== undefined && now - current.fetchedAt < maxAgeMs) {
    return current.value;
  }
  if (!force && current?.promise) return current.promise;

  const version = (current?.version || 0) + 1;
  const promise = Promise.resolve()
    .then(loader)
    .then((value) => {
      const entry = state.entries.get(key);
      if (entry?.version === version) {
        state.entries.set(key, { value, fetchedAt: Date.now(), version });
        while (state.entries.size > MAX_CACHE_ENTRIES) {
          const oldestKey = state.entries.keys().next().value;
          if (oldestKey === undefined) break;
          state.entries.delete(oldestKey);
        }
      }
      return value;
    });

  state.entries.set(key, { ...(current || {}), promise, version, fetchedAt: current?.fetchedAt || 0 });
  promise.finally(() => {
    const entry = state.entries.get(key);
    if (entry?.promise === promise) {
      if (entry.value !== undefined) state.entries.set(key, entry);
      else state.entries.delete(key);
    }
  }).catch(() => {});
  return promise;
}
