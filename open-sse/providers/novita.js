/**
 * Novita AI provider constants and model metadata.
 *
 * Keep this module free of server-only imports so the registry, dashboard and
 * server-side catalog resolver can share the same exact model/pricing data.
 */

export const NOVITA_BASE_URL = "https://api.novita.ai/openai";
export const NOVITA_CHAT_COMPLETIONS_URL = `${NOVITA_BASE_URL}/v1/chat/completions`;
export const NOVITA_MODELS_URL = `${NOVITA_BASE_URL}/v1/models`;
export const NOVITA_BALANCE_URL = "https://api.novita.ai/openapi/v1/billing/balance/detail";
export const NOVITA_QUOTA_LIST_URL = "https://api.novita.ai/openapi/v1/user/quota/list";
export const NOVITA_PRICING_SOURCE_URL = "https://novita.ai/pricing";
export const NOVITA_PRICING_VERIFIED_AT = "2026-09-11";

const snapshot = (input, cached, output, extra = {}) => ({
  input,
  cached,
  output,
  currency: "USD",
  unit: "per_1m_tokens",
  sourceUrl: NOVITA_PRICING_SOURCE_URL,
  verifiedAt: NOVITA_PRICING_VERIFIED_AT,
  effectiveUntil: null,
  promo: false,
  ...extra,
});

/**
 * Exact Novita model IDs observed on the official pricing/model pages at the
 * time of this implementation. Novita's full catalog is dynamic; this is a
 * deliberately small, source-backed snapshot rather than a hardcoded catalog.
 */
export const NOVITA_PRICING_SNAPSHOT = {
  "qwen/qwen3.8-flash": snapshot(0.15, 0.016, 0.47),
  "qwen/qwen3.8-max": snapshot(2.00, 0.25, 6.00),
  "deepseek/deepseek-v4-flash": snapshot(0.14, 0.028, 0.28),
  "deepseek/deepseek-v4-pro": snapshot(1.60, 0.135, 3.20),
  "deepseek/deepseek-v4-pro-0813": snapshot(1.32, 0.044, 3.96),
  "zai-org/glm-5.3-flash": snapshot(0.15, 0.03, 0.50),
  "zai-org/glm-5.3": snapshot(1.40, 0.26, 4.40),
  "moonshotai/kimi-k3": snapshot(3.00, 0.30, 15.00),
  "moonshotai/kimi-k2.7-code": snapshot(0.95, 0.19, 4.00),
  "kimi/k2.7-code": snapshot(0.95, 0.19, 4.00),
  "tencent/hy3": snapshot(0.14, 0.035, 0.58),
  // Keep bare IDs as exact entries too: some Novita-compatible account
  // responses return the vendor ID without its library prefix.
  "qwen3.8-flash": snapshot(0.15, 0.016, 0.47),
  "deepseek-v4-flash": snapshot(0.14, 0.028, 0.28),
  "deepseek-v4-pro": snapshot(1.60, 0.135, 3.20),
  "glm-5.3-flash": snapshot(0.15, 0.03, 0.50),
  "glm-5.3": snapshot(1.40, 0.26, 4.40),
  "kimi-k3": snapshot(3.00, 0.30, 15.00),
  "kimi-k2.7-code": snapshot(0.95, 0.19, 4.00),
  "hy3": snapshot(0.14, 0.035, 0.58),
};

export function getNovitaPricing(modelId) {
  if (typeof modelId !== "string") return null;
  return NOVITA_PRICING_SNAPSHOT[modelId] || null;
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
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

function readCapability(raw, ...keys) {
  const capability = raw?.capabilities && typeof raw.capabilities === "object"
    ? raw.capabilities
    : {};
  return booleanValue(
    ...keys.flatMap((key) => [raw?.[key], capability[key]]),
  );
}

function normalizeRawModelList(data) {
  if (Array.isArray(data)) return data;
  const candidates = [
    data?.data,
    data?.models,
    data?.results,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === "object") {
      // A few OpenAI-compatible gateways return { models: { id: metadata } }.
      if (Array.isArray(candidate.models)) return candidate.models;
      return Object.entries(candidate).map(([id, value]) => ({
        ...(value && typeof value === "object" ? value : {}),
        id: value?.id || value?.model || id,
      }));
    }
  }
  return null;
}

export function hasNovitaModelCatalogSchema(data) {
  return Array.isArray(normalizeRawModelList(data));
}

/**
 * Normalize one live Novita model without inventing missing capabilities.
 * The downstream capability resolver supplies safe family fallbacks; this
 * object only records what Novita actually returned.
 */
export function normalizeNovitaModel(raw) {
  if (typeof raw === "string") raw = { id: raw };
  if (!raw || typeof raw !== "object") return null;

  const id = String(raw.id || raw.model || raw.model_id || raw.name || "").trim();
  if (!id) return null;

  const contextLength = finitePositive(
    raw.contextLength
      ?? raw.context_length
      ?? raw.contextWindow
      ?? raw.context_window
      ?? raw.limit?.context,
  );
  const maxOutputTokens = finitePositive(
    raw.maxOutputTokens
      ?? raw.max_output_tokens
      ?? raw.maxOutput
      ?? raw.max_output
      ?? raw.limit?.output,
  );
  const supportsVision = readCapability(raw, "supportsVision", "vision", "visionInput");
  const supportsReasoning = readCapability(raw, "supportsReasoning", "reasoning", "thinking");
  const supportsTools = readCapability(raw, "supportsTools", "tools", "tool_calling", "toolCalling");
  const supportsSearch = readCapability(raw, "supportsSearch", "search", "webSearch");
  const pricing = getNovitaPricing(id);

  const model = {
    id,
    name: String(raw.displayName || raw.display_name || raw.name || id).trim() || id,
    displayName: String(raw.displayName || raw.display_name || raw.name || id).trim() || id,
    upstreamModelId: String(raw.upstreamModelId || raw.upstream_model_id || id).trim() || id,
    catalogSource: "live",
    verifiedAt: new Date().toISOString(),
    pricingStatus: pricing ? "priced" : "unpriced",
    capabilityStatus: contextLength || maxOutputTokens
      || supportsVision !== undefined
      || supportsReasoning !== undefined
      || supportsTools !== undefined
      || supportsSearch !== undefined
      ? "partial"
      : "missing",
  };

  if (contextLength !== undefined) model.contextLength = contextLength;
  if (maxOutputTokens !== undefined) model.maxOutputTokens = maxOutputTokens;
  if (supportsVision !== undefined) model.supportsVision = supportsVision;
  if (supportsReasoning !== undefined) model.supportsReasoning = supportsReasoning;
  if (supportsTools !== undefined) model.supportsTools = supportsTools;
  if (supportsSearch !== undefined) model.supportsSearch = supportsSearch;
  if (raw.capabilities && typeof raw.capabilities === "object" && !Array.isArray(raw.capabilities)) {
    model.capabilities = { ...raw.capabilities };
  }
  if (raw.availability !== undefined) model.availability = raw.availability;
  if (raw.isFree === true || raw.free === true || raw.promo === true || raw.isPromo === true) {
    model.isFree = true;
    model.billingMode = "promo";
  }
  if (pricing) model.pricing = pricing;
  return model;
}

/**
 * Parse and deduplicate an OpenAI-style Novita /models response. Conflicting
 * duplicates are merged conservatively: the first stable identity/name wins,
 * while missing metadata is filled from later entries.
 */
export function parseNovitaModels(data) {
  const rawModels = normalizeRawModelList(data);
  if (!rawModels) return [];

  const byId = new Map();
  for (const raw of rawModels) {
    const model = normalizeNovitaModel(raw);
    if (!model) continue;
    const previous = byId.get(model.id);
    if (!previous) {
      byId.set(model.id, model);
      continue;
    }

    const mergedCapabilities = previous.capabilities || model.capabilities
      ? { ...(previous.capabilities || {}), ...(model.capabilities || {}) }
      : undefined;
    const merged = { ...previous };
    for (const [key, value] of Object.entries(model)) {
      if (key === "capabilities") continue;
      if (merged[key] === undefined || merged[key] === null || merged[key] === "") merged[key] = value;
    }
    if (mergedCapabilities && Object.keys(mergedCapabilities).length > 0) merged.capabilities = mergedCapabilities;
    byId.set(model.id, merged);
  }
  return [...byId.values()];
}

const staticModel = (id, name = id) => ({
  id,
  name,
  displayName: name,
  upstreamModelId: id,
  catalogSource: "static",
  verifiedAt: NOVITA_PRICING_VERIFIED_AT,
  capabilityStatus: "missing",
  pricingStatus: getNovitaPricing(id) ? "priced" : "unpriced",
  ...(getNovitaPricing(id) ? { pricing: getNovitaPricing(id) } : {}),
});

/** Small fallback only; the full Novita catalog is always resolved live. */
export const NOVITA_STATIC_MODEL_CATALOG = [
  staticModel("qwen/qwen3.8-flash", "Qwen 3.8 Flash"),
  staticModel("qwen/qwen3.8-max", "Qwen 3.8 Max"),
  staticModel("deepseek/deepseek-v4-flash", "DeepSeek V4 Flash"),
  staticModel("deepseek/deepseek-v4-pro", "DeepSeek V4 Pro"),
  staticModel("deepseek/deepseek-v4-pro-0813", "DeepSeek V4 Pro 0813"),
  staticModel("zai-org/glm-5.3-flash", "GLM 5.3 Flash"),
  staticModel("zai-org/glm-5.3", "GLM 5.3"),
  staticModel("moonshotai/kimi-k3", "Kimi K3"),
  staticModel("moonshotai/kimi-k2.7-code", "Kimi K2.7 Code"),
  staticModel("tencent/hy3", "Hy3"),
];
