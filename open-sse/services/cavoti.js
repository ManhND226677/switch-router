import {
  CAVOTI_DEFAULT_MODEL_PATH,
  CAVOTI_ENDPOINT_PROFILES,
  CAVOTI_MODEL_CATALOG,
  CAVOTI_MODEL_KIND_BY_ID,
  CAVOTI_MODEL_PRICING_URL,
  resolveCavotiConnectionEndpoint,
} from "../providers/cavoti.js";

const CAVOTI_REQUEST_TIMEOUT_MS = 8000;
const CAVOTI_PRICING_CACHE_TTL_MS = 5 * 60 * 1000;
let pricingCache = { expiresAt: 0, payload: null };
let pricingRequest = null;

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function modelIdFromPayload(model) {
  const id = model?.id || model?.name || model?.model;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function modelNameFromPayload(model, id) {
  return model?.name || model?.display_name || model?.displayName || id;
}

function normalizePricing(modelPricing) {
  const groups = Array.isArray(modelPricing?.group_prices)
    ? modelPricing.group_prices
    : [];
  const entries = groups
    .map((group) => {
      const pricing = group?.pricing;
      if (!pricing || typeof pricing !== "object") return null;
      const billingMode = pricing.billing_mode || "unknown";
      const entry = {
        groupId: group.group_id ?? null,
        billingMode,
        input: toFiniteNumber(pricing.input_price),
        output: toFiniteNumber(pricing.output_price),
        cached: toFiniteNumber(pricing.cache_read_price),
        cacheCreation: toFiniteNumber(pricing.cache_write_price),
        perRequest: toFiniteNumber(pricing.per_request_price),
        pointPrice: toFiniteNumber(pricing.point_price),
        intervals: Array.isArray(pricing.intervals) ? pricing.intervals : [],
      };

      if (billingMode === "token") {
        // Cavoti publishes token prices in USD/token while the existing
        // pricing contract uses USD per million tokens.
        entry.inputPerMillion = entry.input === null ? null : entry.input * 1_000_000;
        entry.outputPerMillion = entry.output === null ? null : entry.output * 1_000_000;
        entry.cachedPerMillion = entry.cached === null ? null : entry.cached * 1_000_000;
        entry.cacheCreationPerMillion = entry.cacheCreation === null ? null : entry.cacheCreation * 1_000_000;
      }

      if (billingMode === "per_request") entry.unit = "USD/request";
      else if (billingMode === "per_second") entry.unit = "USD/second";
      else if (billingMode === "token") entry.unit = "USD/1M tokens";
      else entry.unit = "USD";

      return entry;
    })
    .filter(Boolean);

  if (entries.length === 0) return null;
  const primary = entries[0];
  return {
    source: "cavoti-public",
    billingMode: primary.billingMode,
    unit: primary.unit,
    input: primary.inputPerMillion ?? primary.input,
    output: primary.outputPerMillion ?? primary.output,
    cached: primary.cachedPerMillion ?? primary.cached,
    cacheCreation: primary.cacheCreationPerMillion ?? primary.cacheCreation,
    perRequest: primary.perRequest,
    pointPrice: primary.pointPrice,
    intervals: primary.intervals,
    groups: entries,
  };
}

function pricingIndex(payload) {
  const index = new Map();
  const platforms = Array.isArray(payload?.data?.platforms) ? payload.data.platforms : [];
  for (const platform of platforms) {
    for (const model of Array.isArray(platform?.models) ? platform.models : []) {
      const id = modelIdFromPayload(model);
      if (id) index.set(id, normalizePricing(model));
    }
  }
  return index;
}

function staticModel(id) {
  return CAVOTI_MODEL_CATALOG.find((model) => model.id === id) || null;
}

function normalizeLiveModel(model, pricingById) {
  const id = modelIdFromPayload(model);
  if (!id) return null;
  const staticEntry = staticModel(id);
  const kind = staticEntry?.kind || CAVOTI_MODEL_KIND_BY_ID[id] || "llm";
  const pricing = pricingById.get(id) || null;
  return {
    ...(staticEntry || {}),
    ...model,
    id,
    name: modelNameFromPayload(model, staticEntry?.name || id),
    kind,
    availability: "available",
    ...(pricing ? { pricing } : {}),
  };
}

function buildCatalogOnlyModels(liveIds, pricingById) {
  return CAVOTI_MODEL_CATALOG
    .filter((model) => !liveIds.has(model.id))
    .map((model) => ({
      ...model,
      availability: "catalog-only",
      ...(pricingById.has(model.id) ? { pricing: pricingById.get(model.id) } : {}),
    }));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(CAVOTI_REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    throw new Error(`Cavoti request failed (${response.status})`);
  }
  return body;
}

export async function fetchCavotiPricing() {
  if (pricingCache.payload && pricingCache.expiresAt > Date.now()) {
    return pricingCache.payload;
  }
  if (pricingRequest) return await pricingRequest;

  pricingRequest = fetchJson(CAVOTI_MODEL_PRICING_URL)
    .then((payload) => {
      pricingCache = {
        payload,
        expiresAt: Date.now() + CAVOTI_PRICING_CACHE_TTL_MS,
      };
      return payload;
    })
    .finally(() => {
      pricingRequest = null;
    });

  return await pricingRequest;
}

export async function fetchCavotiModels(connection, options = {}) {
  const token = connection?.apiKey || connection?.accessToken;
  if (!token) return { models: [], warning: "Cavoti API key is missing." };

  const endpointProfile = connection?.providerSpecificData?.endpointProfile;
  const modelsUrl = resolveCavotiConnectionEndpoint(
    connection,
    "models",
    CAVOTI_DEFAULT_MODEL_PATH,
  );
  const pricingPromise = options.includePricing === false
    ? Promise.resolve(null)
    : fetchCavotiPricing().catch(() => null);

  let livePayload;
  try {
    livePayload = await fetchJson(modelsUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (error) {
    const pricingPayload = await pricingPromise;
    const pricingById = pricingIndex(pricingPayload);
    return {
      models: buildCatalogOnlyModels(new Set(), pricingById),
      warning: `${error.message}; using Cavoti static/public catalog.`,
      endpointProfile,
    };
  }

  const pricingPayload = await pricingPromise;
  const pricingById = pricingIndex(pricingPayload);
  const rawModels = Array.isArray(livePayload)
    ? livePayload
    : livePayload?.data || livePayload?.models || livePayload?.results || [];
  const liveModels = rawModels.map((model) => normalizeLiveModel(model, pricingById)).filter(Boolean);
  const liveIds = new Set(liveModels.map((model) => model.id));
  const catalogOnly = buildCatalogOnlyModels(liveIds, pricingById);

  return {
    models: [...liveModels, ...catalogOnly],
    endpointProfile,
    pricingUpdatedAt: pricingPayload?.data?.updated_at || null,
  };
}

export function getCavotiStaticCatalog() {
  return CAVOTI_MODEL_CATALOG.map((model) => ({
    ...model,
    availability: "catalog-only",
  }));
}

export function getCavotiModelKind(modelId) {
  return CAVOTI_MODEL_KIND_BY_ID[modelId] || "llm";
}

export function getCavotiEndpointProfiles() {
  return CAVOTI_ENDPOINT_PROFILES;
}
