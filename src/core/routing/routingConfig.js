export const FALLBACK_STRATEGIES = Object.freeze(["fill-first", "round-robin"]);
export const ROTATE_STRATEGIES = Object.freeze(["none", "round-robin", "random"]);

export const DEFAULT_ROUTING_CONFIG = Object.freeze({
  fallbackStrategy: "fill-first",
  stickyRoundRobinLimit: 3,
  rotateStrategy: "none",
  proxyPoolId: null,
});

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.floor(number);
}

export function normalizeFallbackStrategy(value, fallback = DEFAULT_ROUTING_CONFIG.fallbackStrategy) {
  return FALLBACK_STRATEGIES.includes(value) ? value : fallback;
}

export function normalizeRotateStrategy(value, fallback = DEFAULT_ROUTING_CONFIG.rotateStrategy) {
  return ROTATE_STRATEGIES.includes(value) ? value : fallback;
}

export function normalizeOptionalId(value) {
  if (value === undefined || value === null || value === "" || value === "__none__") return null;
  const normalized = String(value).trim();
  return normalized || null;
}

/**
 * Normalize one provider override while preserving unknown keys for forward
 * compatibility with future routing options.
 */
export function normalizeProviderRoutingOverride(override = {}) {
  const normalized = override && typeof override === "object" ? { ...override } : {};

  if (hasOwn(normalized, "fallbackStrategy")) {
    if (normalized.fallbackStrategy === null || normalized.fallbackStrategy === "") {
      delete normalized.fallbackStrategy;
    } else {
      normalized.fallbackStrategy = normalizeFallbackStrategy(normalized.fallbackStrategy);
    }
  }

  if (hasOwn(normalized, "stickyRoundRobinLimit")) {
    if (normalized.stickyRoundRobinLimit === null || normalized.stickyRoundRobinLimit === "") {
      delete normalized.stickyRoundRobinLimit;
    } else {
      normalized.stickyRoundRobinLimit = normalizePositiveInteger(
        normalized.stickyRoundRobinLimit,
        DEFAULT_ROUTING_CONFIG.stickyRoundRobinLimit,
      );
    }
  }

  if (hasOwn(normalized, "rotateStrategy")) {
    normalized.rotateStrategy = normalizeRotateStrategy(normalized.rotateStrategy);
  }

  if (hasOwn(normalized, "proxyPoolId")) {
    normalized.proxyPoolId = normalizeOptionalId(normalized.proxyPoolId);
  }

  return normalized;
}

/**
 * Resolve the effective policy for one provider. Connection selection remains
 * in auth.js, but it now consumes one normalized contract for global and
 * provider-specific settings.
 */
export function getProviderRoutingPolicy(settings = {}, provider) {
  const override = normalizeProviderRoutingOverride(settings?.providerStrategies?.[provider]);
  const fallbackStrategy = normalizeFallbackStrategy(
    settings?.fallbackStrategy,
    DEFAULT_ROUTING_CONFIG.fallbackStrategy,
  );
  const stickyRoundRobinLimit = normalizePositiveInteger(
    settings?.stickyRoundRobinLimit,
    DEFAULT_ROUTING_CONFIG.stickyRoundRobinLimit,
  );

  return {
    fallbackStrategy: normalizeFallbackStrategy(override.fallbackStrategy, fallbackStrategy),
    stickyRoundRobinLimit: normalizePositiveInteger(
      override.stickyRoundRobinLimit,
      stickyRoundRobinLimit,
    ),
    rotateStrategy: normalizeRotateStrategy(override.rotateStrategy),
    proxyPoolId: normalizeOptionalId(override.proxyPoolId),
  };
}

/**
 * Normalize only routing-related fields in a settings PATCH. Other settings
 * remain untouched and can continue to evolve independently.
 */
export function normalizeRoutingSettingsPatch(updates = {}) {
  const normalized = { ...updates };

  if (hasOwn(normalized, "fallbackStrategy")) {
    normalized.fallbackStrategy = normalizeFallbackStrategy(normalized.fallbackStrategy);
  }

  if (hasOwn(normalized, "stickyRoundRobinLimit")) {
    normalized.stickyRoundRobinLimit = normalizePositiveInteger(
      normalized.stickyRoundRobinLimit,
      DEFAULT_ROUTING_CONFIG.stickyRoundRobinLimit,
    );
  }

  if (hasOwn(normalized, "providerStrategies")) {
    const source = normalized.providerStrategies && typeof normalized.providerStrategies === "object"
      ? normalized.providerStrategies
      : {};
    normalized.providerStrategies = Object.fromEntries(
      Object.entries(source).map(([provider, override]) => [provider, normalizeProviderRoutingOverride(override)]),
    );
  }

  return normalized;
}
