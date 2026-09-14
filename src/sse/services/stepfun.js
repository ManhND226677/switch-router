import {
  STEPFUN_MODEL_KIND_BY_ID,
  getStepFunStaticCatalog,
  resolveStepFunEndpoints,
} from "open-sse/providers/stepfun.js";

const REQUEST_TIMEOUT_MS = 8000;

function getToken(connection) {
  return connection?.apiKey || connection?.accessToken || null;
}

function modelIdFromPayload(model) {
  const id = model?.id || model?.name || model?.model;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function inferKind(modelId) {
  const lower = modelId.toLowerCase();
  if (STEPFUN_MODEL_KIND_BY_ID[modelId]) return STEPFUN_MODEL_KIND_BY_ID[modelId];
  if (/realtime/.test(lower)) return "realtime";
  return "llm";
}

function normalizeModel(model) {
  const id = modelIdFromPayload(model);
  if (!id) return null;
  const staticModel = getStepFunStaticCatalog().find((entry) => entry.id === id);
  return {
    ...(staticModel || {}),
    ...(model && typeof model === "object" ? model : {}),
    id,
    name: model?.name || model?.display_name || model?.displayName || staticModel?.name || id,
    kind: model?.kind || model?.type || staticModel?.kind || inferKind(id),
    availability: "available",
  };
}

export function stepFunAuthHeaders(credentials, extra = {}) {
  const token = getToken(credentials);
  return {
    ...extra,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function resolveStepFunModel(model, fallback = "step-3.7-flash") {
  if (typeof model !== "string" || !model.trim()) return fallback;
  const value = model.trim();
  return value.includes("/") ? value.slice(value.indexOf("/") + 1) : value;
}

export async function fetchStepFunModels(connection) {
  const token = getToken(connection);
  const endpoints = resolveStepFunEndpoints(connection);
  if (!token) return { models: getStepFunStaticCatalog(), warning: "StepFun API key is missing." };

  try {
    const response = await fetch(endpoints.models, {
      method: "GET",
      headers: stepFunAuthHeaders(connection, { Accept: "application/json" }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`StepFun model request failed (${response.status})`);
    const payload = await response.json();
    const rawModels = Array.isArray(payload) ? payload : payload?.data || payload?.models || [];
    const liveModels = rawModels.map(normalizeModel).filter(Boolean);
    if (!liveModels.length) throw new Error("StepFun returned no models");

    const liveIds = new Set(liveModels.map((model) => model.id));
    const catalogOnly = getStepFunStaticCatalog().filter((model) => !liveIds.has(model.id));
    return { models: [...liveModels, ...catalogOnly] };
  } catch (error) {
    return {
      models: getStepFunStaticCatalog(),
      warning: `${error.message}; using StepFun static catalog.`,
    };
  }
}

export { getToken as getStepFunToken };
