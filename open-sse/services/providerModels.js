/**
 * Credential-aware provider model catalogs.
 *
 * Public suggested-model fetchers intentionally remain unauthenticated. These
 * resolvers are for account-scoped catalogs only and cache by provider plus
 * connection id, never by a raw credential.
 */

import { randomUUID } from "node:crypto";
import { getModelsByProviderId } from "../config/providerModels.js";
import { resolveWorkbuddySession } from "../executors/workbuddy.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import {
  NOVITA_MODELS_URL,
  hasNovitaModelCatalogSchema,
  parseNovitaModels,
} from "../providers/novita.js";
import {
  filterWorkbuddyModels,
  isWorkbuddyFreeModel,
} from "../providers/workbuddyCatalog.js";

export const WORKBUDDY_MODELS_URL = "https://www.workbuddy.ai/v3/config";
export const PROVIDER_MODEL_CATALOG_TTL_MS = 10 * 60 * 1000;
// The config endpoint validates the client identity in addition to the
// session token. Keep the value overridable because WorkBuddy can bump its
// desktop version without changing the catalog contract.
export const WORKBUDDY_CLIENT_VERSION = process.env.WORKBUDDY_CLIENT_VERSION || "5.5.2";

const catalogCache = globalThis.__providerModelCatalogCache ??= new Map();

function cacheKey(provider, connectionId) {
  return `catalog:${provider}:${connectionId}`;
}

export function clearProviderModelCatalogCache(provider = null, connectionId = null) {
  if (!provider && !connectionId) {
    catalogCache.clear();
    return;
  }
  const exact = provider && connectionId ? cacheKey(provider, connectionId) : null;
  const providerPrefix = provider ? `catalog:${provider}:` : null;
  const connectionSuffix = connectionId ? `:${connectionId}` : null;
  for (const key of catalogCache.keys()) {
    if (key === exact || (providerPrefix && key.startsWith(providerPrefix)) || (connectionSuffix && key.endsWith(connectionSuffix))) {
      catalogCache.delete(key);
    }
  }
}

// Usage responses can report the most recent catalog state without triggering
// a second upstream request. A missing entry means the catalog has not been
// resolved in this process yet, not that the account has no models.
export function getProviderModelCatalogStatus(provider, connectionId) {
  return catalogCache.get(cacheKey(provider, connectionId || "anonymous"))?.value?.catalogStatus || "unknown";
}

async function cachedCatalog(provider, connectionId, force, loader) {
  const key = cacheKey(provider, connectionId || "anonymous");
  const current = catalogCache.get(key);
  const now = Date.now();

  if (!force && current?.value && current.expiresAt > now) return current.value;
  // A manual refresh still shares an in-flight request; this prevents a
  // double refresh when the model page and /v1/models are opened together.
  if (current?.promise) return current.promise;

  const promise = Promise.resolve()
    .then(() => loader(current?.value || null))
    .then((value) => {
      catalogCache.set(key, {
        value,
        expiresAt: Date.now() + PROVIDER_MODEL_CATALOG_TTL_MS,
      });
      return value;
    });

  catalogCache.set(key, {
    ...(current || {}),
    promise,
    expiresAt: current?.expiresAt || 0,
  });
  promise.finally(() => {
    const latest = catalogCache.get(key);
    if (latest?.promise === promise) {
      if (latest.value) {
        catalogCache.set(key, latest);
      } else {
        catalogCache.delete(key);
      }
    }
  }).catch(() => {});
  return promise;
}

function positiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return undefined;
}

function nonNegativeNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return undefined;
}

function booleanValue(...values) {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string" && /^(true|false)$/i.test(value.trim())) {
      return value.trim().toLowerCase() === "true";
    }
  }
  return undefined;
}

function getWorkbuddyFallbackModels() {
  return filterWorkbuddyModels(getModelsByProviderId("workbuddy"));
}

function isTimeoutError(error) {
  return error?.name === "TimeoutError"
    || error?.name === "AbortError"
    || /timeout|timed out/i.test(String(error?.message || ""));
}

function objectModelList(candidate) {
  if (Array.isArray(candidate)) return candidate;
  if (!candidate || typeof candidate !== "object") return null;
  return Object.entries(candidate).map(([id, value]) => ({
    ...(value && typeof value === "object" ? value : {}),
    id: value?.id || value?.model || id,
  }));
}

function extractWorkbuddyAllowedModelIds(data) {
  const agentCandidates = [
    data?.agents,
    data?.data?.agents,
    data?.data?.agent?.agents,
    data?.config?.agents,
    data?.data?.config?.agents,
  ];
  const agents = agentCandidates.flatMap((candidate) => {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === "object") return Object.values(candidate);
    return [];
  });
  if (agents.length === 0) return null;

  const preferred = agents.find((agent) => /cli|craft|workbuddy/i.test(String(agent?.name || agent?.id || agent?.type || "")))
    || agents[0];
  const ids = preferred?.models
    || preferred?.modelIds
    || preferred?.model_ids
    || preferred?.availableModels;
  if (Array.isArray(ids)) {
    return ids
      .map((id) => typeof id === "string" ? id.trim() : id?.id || id?.model || id?.name)
      .filter((id) => typeof id === "string" && id.trim() !== "");
  }
  if (ids && typeof ids === "object") return Object.keys(ids).filter(Boolean);
  return null;
}

function extractWorkbuddyPromotionIds(data) {
  const candidates = [
    data?.modelPromotions,
    data?.data?.modelPromotions,
    data?.config?.modelPromotions,
    data?.data?.config?.modelPromotions,
  ];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const ids = candidate
      .map((promotion) => typeof promotion === "string"
        ? promotion
        : promotion?.id || promotion?.model || promotion?.modelId || promotion?.model_id)
      .filter((id) => typeof id === "string" && id.trim() !== "")
      .map((id) => id.trim());
    if (ids.length > 0) return new Set(ids);
  }
  return new Set();
}

function extractWorkbuddyModelList(data) {
  const candidates = [
    data?.models,
    data?.data?.models,
    data?.config?.models,
    data?.data?.config?.models,
    data?.modelList,
    data?.data?.modelList,
  ];
  let models = null;
  for (const candidate of candidates) {
    models = objectModelList(candidate);
    if (models) break;
  }
  if (!models) return null;

  // Some responses contain a broad model dictionary plus a per-agent
  // allowlist. Prefer that allowlist so models enabled for another product or
  // an internal agent are not advertised by WorkBuddy.
  const allowedIds = extractWorkbuddyAllowedModelIds(data);
  if (!allowedIds?.length) return models;
  const byId = new Map(models.map((model) => [String(model?.id || "").trim(), model]));
  const promotionIds = extractWorkbuddyPromotionIds(data);
  return allowedIds.map((id) => {
    const model = byId.get(id) || { id };
    return promotionIds.has(id)
      ? { ...model, isFree: true, billingMode: "free_trial" }
      : model;
  }).filter(Boolean);
}

function normalizeWorkbuddyModel(raw, verifiedAt = new Date().toISOString()) {
  if (typeof raw === "string") raw = { id: raw };
  if (!raw || typeof raw !== "object") return null;

  const id = String(raw.id || raw.model || raw.modelId || raw.model_id || "").trim();
  if (!id) return null;

  const contextLength = positiveNumber(
    raw.contextLength,
    raw.context_length,
    raw.contextWindow,
    raw.context_window,
    raw.maxInputTokens,
    raw.max_input_tokens,
    raw.limit?.context,
  );
  const maxOutputTokens = positiveNumber(
    raw.maxOutputTokens,
    raw.max_output_tokens,
    raw.maxOutput,
    raw.max_output,
    raw.limit?.output,
  );
  const supportsVision = booleanValue(
    raw.supportsVision,
    raw.supports_vision,
    raw.vision,
    raw.capabilities?.vision,
  );
  const supportsReasoning = booleanValue(
    raw.supportsReasoning,
    raw.supports_reasoning,
    raw.reasoning,
    raw.thinking,
    raw.capabilities?.reasoning,
  );
  const creditMultiplier = nonNegativeNumber(
    raw.creditMultiplier,
    raw.credit_multiplier,
    raw.creditRate,
    raw.credit_rate,
    raw.coefficient,
    raw.multiplier,
    raw.billing?.creditMultiplier,
  );
  const available = booleanValue(
    raw.available,
    raw.isAvailable,
    raw.is_available,
    raw.enabled,
    raw.supported,
    raw.isSupported,
    raw.is_supported,
  );
  const billingModeValue = raw.billingMode || raw.billing_mode || raw.billingType || raw.billing_type;
  const normalizedBillingMode = typeof billingModeValue === "string" ? billingModeValue.trim() : "";
  const isFreeFlag = booleanValue(
    raw.isFree,
    raw.is_free,
    raw.free,
    raw.promo,
    raw.isPromo,
    raw.freeTrial,
    raw.free_trial,
  );
  const isFree = isFreeFlag === true || isWorkbuddyFreeModel({ billingMode: normalizedBillingMode });

  const model = {
    id,
    name: String(raw.displayName || raw.display_name || raw.name || id).trim() || id,
    displayName: String(raw.displayName || raw.display_name || raw.name || id).trim() || id,
    upstreamModelId: String(raw.upstreamModelId || raw.upstream_model_id || raw.upstreamId || id).trim() || id,
    catalogSource: "live",
    verifiedAt,
    ...(available !== undefined ? { available } : {}),
    ...(contextLength !== undefined ? { contextLength } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(supportsVision !== undefined ? { supportsVision } : {}),
    ...(supportsReasoning !== undefined ? { supportsReasoning } : {}),
    ...(creditMultiplier !== undefined ? { creditMultiplier, source: "workbuddy-live-catalog" } : {}),
    ...(isFree === true ? { isFree: true, billingMode: normalizedBillingMode || "promo" } : {}),
  };

  if (normalizedBillingMode) model.billingMode = normalizedBillingMode;
  if (raw.capabilities && typeof raw.capabilities === "object" && !Array.isArray(raw.capabilities)) {
    model.capabilities = { ...raw.capabilities };
  }
  return model;
}

/**
 * WorkBuddy catalog parser. Duplicate IDs with conflicting upstream identities
 * are rejected as unsafe; identical duplicates are collapsed.
 */
export function parseWorkbuddyCatalog(data, verifiedAt = new Date().toISOString()) {
  const rawModels = extractWorkbuddyModelList(data);
  if (!rawModels) return { valid: false, models: [], errorCode: "invalid_schema" };

  const byId = new Map();
  for (const raw of rawModels) {
    const model = normalizeWorkbuddyModel(raw, verifiedAt);
    if (!model) continue;
    const previous = byId.get(model.id);
    if (!previous) {
      byId.set(model.id, model);
      continue;
    }
    if (
      previous.upstreamModelId !== model.upstreamModelId
      || (previous.available !== undefined && model.available !== undefined && previous.available !== model.available)
    ) {
      return { valid: false, models: [], errorCode: "duplicate_conflict" };
    }

    const merged = { ...previous };
    for (const [key, value] of Object.entries(model)) {
      if (merged[key] === undefined || merged[key] === null || merged[key] === "") merged[key] = value;
    }
    if (previous.capabilities || model.capabilities) {
      merged.capabilities = { ...(previous.capabilities || {}), ...(model.capabilities || {}) };
    }
    byId.set(model.id, merged);
  }

  if (byId.size === 0) return { valid: false, models: [], errorCode: "no_valid_models" };
  return { valid: true, models: [...byId.values()] };
}

function mergeWorkbuddyCatalog(liveModels) {
  const staticModels = getModelsByProviderId("workbuddy");
  const liveById = new Map(liveModels.map((model) => [model.id, model]));
  const merged = [];

  // Keep every legacy/static model in the merged internal result. A successful
  // account catalog marks models absent from that account unavailable instead
  // of deleting them; the shared visibility filter decides what is advertised.
  for (const staticModel of staticModels) {
    const liveModel = liveById.get(staticModel.id);
    if (liveModel) {
      merged.push({ ...staticModel, ...liveModel, available: liveModel.available !== false });
      liveById.delete(staticModel.id);
    } else {
      merged.push({ ...staticModel, available: false });
    }
  }
  for (const liveModel of liveById.values()) {
    merged.push({ ...liveModel, available: liveModel.available !== false });
  }
  return merged;
}

function statusFromResponse(response) {
  return `http_${response.status}`;
}

async function fetchJson(url, options, proxyOptions) {
  const response = await proxyAwareFetch(url, {
    ...options,
    signal: AbortSignal.timeout(10000),
  }, proxyOptions);
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { response, data };
}

export async function resolveWorkbuddyModels(connection, { force = false, proxyOptions = null } = {}) {
  const connectionId = connection?.id || "anonymous";
  return cachedCatalog("workbuddy", connectionId, force, async (previous) => {
    const fallbackModels = previous?.models?.length ? previous.models : getWorkbuddyFallbackModels();
    const session = resolveWorkbuddySession(connection);
    if (!session?.accessToken) {
      return {
        models: fallbackModels,
        catalogStatus: "fallback",
        lastSuccessAt: previous?.lastSuccessAt || null,
        errorCode: "missing_session",
      };
    }

    try {
      const headers = {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-Domain": "www.workbuddy.ai",
        "X-Product": "SaaS",
        "X-IDE-Type": "WorkBuddy",
        "X-IDE-Name": "WorkBuddy",
        "X-IDE-Version": WORKBUDDY_CLIENT_VERSION,
        "X-Product-Version": WORKBUDDY_CLIENT_VERSION,
        "X-Env-ID": "production",
        "X-Request-Trace-Id": randomUUID(),
        Origin: "https://www.workbuddy.ai",
        Referer: "https://www.workbuddy.ai/",
        "User-Agent": `WorkBuddy/${WORKBUDDY_CLIENT_VERSION}`,
        Authorization: `Bearer ${session.accessToken}`,
      };
      if (session.uid) headers["X-User-Id"] = encodeURIComponent(session.uid);
      const { response, data } = await fetchJson(
        WORKBUDDY_MODELS_URL,
        { method: "GET", headers },
        proxyOptions,
      );
      if (!response.ok) {
        return {
          models: fallbackModels,
          catalogStatus: "fallback",
          lastSuccessAt: previous?.lastSuccessAt || null,
          errorCode: statusFromResponse(response),
        };
      }

      const parsed = parseWorkbuddyCatalog(data);
      if (!parsed.valid) {
        return {
          models: fallbackModels,
          catalogStatus: "fallback",
          lastSuccessAt: previous?.lastSuccessAt || null,
          errorCode: parsed.errorCode,
        };
      }

      const lastSuccessAt = new Date().toISOString();
      return {
        models: filterWorkbuddyModels(mergeWorkbuddyCatalog(parsed.models)),
        catalogStatus: "live",
        lastSuccessAt,
        fetchedAt: lastSuccessAt,
        errorCode: null,
      };
    } catch (error) {
      return {
        models: fallbackModels,
        catalogStatus: "fallback",
        lastSuccessAt: previous?.lastSuccessAt || null,
        errorCode: isTimeoutError(error) ? "timeout" : "network_error",
      };
    }
  });
}

export async function resolveNovitaModels(connection, { force = false, proxyOptions = null } = {}) {
  const connectionId = connection?.id || "anonymous";
  return cachedCatalog("novita", connectionId, force, async (previous) => {
    const apiKey = typeof connection?.apiKey === "string" ? connection.apiKey.trim() : "";
    if (!apiKey) {
      return {
        models: previous?.models || [],
        catalogStatus: "fallback",
        lastSuccessAt: previous?.lastSuccessAt || null,
        errorCode: "missing_api_key",
      };
    }

    try {
      const { response, data } = await fetchJson(
        NOVITA_MODELS_URL,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
        },
        proxyOptions,
      );
      if (!response.ok) {
        return {
          models: previous?.models || [],
          catalogStatus: "fallback",
          lastSuccessAt: previous?.lastSuccessAt || null,
          errorCode: statusFromResponse(response),
        };
      }
      if (!hasNovitaModelCatalogSchema(data)) {
        return {
          models: previous?.models || [],
          catalogStatus: "fallback",
          lastSuccessAt: previous?.lastSuccessAt || null,
          errorCode: "invalid_schema",
        };
      }
      const models = parseNovitaModels(data);
      if (models.length === 0) {
        return {
          models: previous?.models || [],
          catalogStatus: "fallback",
          lastSuccessAt: previous?.lastSuccessAt || null,
          errorCode: "no_valid_models",
        };
      }
      const lastSuccessAt = new Date().toISOString();
      return {
        models,
        catalogStatus: "live",
        lastSuccessAt,
        fetchedAt: lastSuccessAt,
        errorCode: null,
      };
    } catch (error) {
      return {
        models: previous?.models || [],
        catalogStatus: "fallback",
        lastSuccessAt: previous?.lastSuccessAt || null,
        errorCode: isTimeoutError(error) ? "timeout" : "network_error",
      };
    }
  });
}
