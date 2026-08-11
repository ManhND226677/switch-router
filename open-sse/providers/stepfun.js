export const STEPFUN_PAYG_BASE_URL = "https://api.stepfun.ai/v1";
export const STEPFUN_TOKEN_PLAN_BASE_URL = "https://api.stepfun.ai/step_plan/v1";

// Step Plan is the default because its API key is scoped to the subscription
// service. Pay-as-you-go remains selectable per connection for existing keys.
export const STEPFUN_DEFAULT_API_MODE = "token-plan";

export const STEPFUN_API_MODES = Object.freeze([
  Object.freeze({
    id: "payg",
    label: "Pay as you go",
    baseUrl: STEPFUN_PAYG_BASE_URL,
  }),
  Object.freeze({
    id: "token-plan",
    label: "Token plan (Step Plan)",
    baseUrl: STEPFUN_TOKEN_PLAN_BASE_URL,
  }),
]);

function buildEndpoints(baseUrl) {
  return Object.freeze({
    chat: `${baseUrl}/chat/completions`,
    messages: `${baseUrl}/messages`,
    responses: `${baseUrl}/responses`,
    models: `${baseUrl}/models`,
    accounts: `${baseUrl}/accounts`,
    files: `${baseUrl}/files`,
    tokenCount: `${baseUrl}/token/count`,
  });
}

export const STEPFUN_PAYG_ENDPOINTS = buildEndpoints(STEPFUN_PAYG_BASE_URL);
export const STEPFUN_TOKEN_PLAN_ENDPOINTS = buildEndpoints(STEPFUN_TOKEN_PLAN_BASE_URL);

// Keep the short names used by the provider registry and existing callers
// pointed at the current default mode.
export const STEPFUN_BASE_URL = STEPFUN_TOKEN_PLAN_BASE_URL;
export const STEPFUN_ENDPOINTS = STEPFUN_TOKEN_PLAN_ENDPOINTS;

function normalizeApiMode(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (["payg", "pay-as-you-go", "pay-as-you-go-api", "standard", "standard-api", "api"].includes(normalized)) {
    return "payg";
  }
  if (["token-plan", "tokenplan", "step-plan", "stepplan", "subscription", "plan"].includes(normalized)) {
    return "token-plan";
  }
  return null;
}

export function resolveStepFunApiMode(value = {}) {
  const providerSpecificData = value?.providerSpecificData && typeof value.providerSpecificData === "object"
    ? value.providerSpecificData
    : value;
  return normalizeApiMode(
    providerSpecificData?.apiMode || providerSpecificData?.endpointProfile || providerSpecificData?.plan,
  ) || STEPFUN_DEFAULT_API_MODE;
}

export function resolveStepFunEndpoints(value = {}) {
  return resolveStepFunApiMode(value) === "payg"
    ? STEPFUN_PAYG_ENDPOINTS
    : STEPFUN_TOKEN_PLAN_ENDPOINTS;
}

export const STEPFUN_STATIC_MODEL_CATALOG = Object.freeze([
  Object.freeze({ id: "step-3.7-flash", name: "Step 3.7 Flash", kind: "llm" }),
  Object.freeze({ id: "step-3.5-flash", name: "Step 3.5 Flash", kind: "llm" }),
  Object.freeze({ id: "step-3.5-flash-2603", name: "Step 3.5 Flash 2603", kind: "llm" }),
  Object.freeze({ id: "stepaudio-2.5-chat", name: "StepAudio 2.5 Chat", kind: "llm" }),
]);

export const STEPFUN_MODEL_KIND_BY_ID = Object.freeze(
  Object.fromEntries(STEPFUN_STATIC_MODEL_CATALOG.map((model) => [model.id, model.kind])),
);

export function resolveStepFunEndpoint(format = "openai", providerSpecificData = {}) {
  const endpoints = resolveStepFunEndpoints(providerSpecificData);
  if (format === "claude") return endpoints.messages;
  if (format === "openai-responses") return endpoints.responses;
  return endpoints.chat;
}

export function getStepFunStaticCatalog() {
  return STEPFUN_STATIC_MODEL_CATALOG.map((model) => ({ ...model, availability: "catalog-only" }));
}
