import { getExecutor } from "../../../open-sse/executors/index.js";

/**
 * Stable boundary between routing code and the existing provider executors.
 *
 * The executor remains responsible for provider-specific HTTP behavior:
 * request transformation, headers, retries, fallback URLs, timeout handling,
 * streaming and provider-specific credential refresh. The adapter exposes the
 * small contract that a routing engine needs without making it depend on the
 * concrete executor classes.
 */
export class ProviderAdapter {
  constructor(provider, executor) {
    if (!provider || typeof provider !== "string") {
      throw new TypeError("ProviderAdapter requires a provider id");
    }
    if (!executor || typeof executor.execute !== "function") {
      throw new TypeError(`ProviderAdapter requires an executor for ${provider}`);
    }

    this.provider = provider;
    this.executor = executor;
  }

  get noAuth() {
    return this.executor.noAuth === true;
  }

  async execute(options) {
    return this.executor.execute(options);
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    if (typeof this.executor.refreshCredentials !== "function") return null;
    return this.executor.refreshCredentials(credentials, log, proxyOptions);
  }

  needsRefresh(credentials) {
    if (typeof this.executor.needsRefresh !== "function") return false;
    return this.executor.needsRefresh(credentials);
  }

  parseError(response, bodyText) {
    if (typeof this.executor.parseError !== "function") {
      return { status: response.status, message: bodyText || `HTTP ${response.status}` };
    }
    return this.executor.parseError(response, bodyText);
  }
}

const adapterCache = new Map();

/**
 * Create an adapter explicitly. The injectable executor keeps the boundary
 * easy to unit-test and allows a future Switch-Router registry to supply a
 * custom provider implementation without changing chatCore.
 */
export function createProviderAdapter(provider, executor = getExecutor(provider)) {
  return new ProviderAdapter(provider, executor);
}

/**
 * Return the cached adapter for a provider id. getExecutor already caches
 * concrete executors, so this cache only adds the stable routing facade.
 */
export function getProviderAdapter(provider) {
  if (!adapterCache.has(provider)) {
    adapterCache.set(provider, createProviderAdapter(provider));
  }
  return adapterCache.get(provider);
}

/**
 * Clear only the adapter layer. Useful for tests and future live config reloads.
 */
export function clearProviderAdapterCache() {
  adapterCache.clear();
}

export default getProviderAdapter;
