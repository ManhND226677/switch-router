import { extractApiKey, isValidApiKey } from "@/sse/services/auth.js";

export const OFFICE_GATEWAY_ORIGIN = "https://pivot.claude.ai";
export const OFFICE_GATEWAY_MODEL_ENV = "OFFICE_MODEL_IDS";

const OFFICE_ALLOWED_HEADERS = [
  "x-api-key",
  "authorization",
  "content-type",
  "anthropic-version",
  "anthropic-beta",
  "accept",
];

function isTruthyEnv(value) {
  return value === "1" || value?.toLowerCase?.() === "true";
}

export function isOfficeGatewayEnabled() {
  return isTruthyEnv(process.env.OFFICE_GATEWAY_ENABLED);
}

export function getOfficeModelIds() {
  return String(process.env[OFFICE_GATEWAY_MODEL_ENV] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function isOfficeModelId(modelId) {
  if (typeof modelId !== "string") return false;
  return /claude/i.test(modelId);
}

export function selectOfficeModelIds(models) {
  const allowlist = getOfficeModelIds();
  const candidates = Array.isArray(models) ? models : [];
  const selected = allowlist.length > 0
    ? candidates.filter((model) => allowlist.includes(model?.id))
    : candidates.filter((model) => isOfficeModelId(model?.id));

  const seen = new Set();
  return selected.filter((model) => {
    const id = model?.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function buildOfficeCorsHeaders(request) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": OFFICE_ALLOWED_HEADERS.join(", "),
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };

  const origin = request?.headers?.get?.("origin");
  if (!origin || origin === OFFICE_GATEWAY_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = OFFICE_GATEWAY_ORIGIN;
  }

  return headers;
}

export function withOfficeCors(response, request) {
  const headers = new Headers(response?.headers || {});
  for (const [name, value] of Object.entries(buildOfficeCorsHeaders(request))) {
    headers.set(name, value);
  }

  return new Response(response?.body || null, {
    status: response?.status || 200,
    statusText: response?.statusText,
    headers,
  });
}

export function officeJsonResponse(body, request, options = {}) {
  return withOfficeCors(Response.json(body, options), request);
}

export function officeErrorResponse(status, message, request, type = "invalid_request_error") {
  return officeJsonResponse(
    { error: { message, type } },
    request,
    { status },
  );
}

export function officeOptionsResponse(request) {
  if (!isOfficeGatewayEnabled()) {
    return officeErrorResponse(404, "Office gateway is disabled", request, "not_found_error");
  }

  return withOfficeCors(new Response(null, { status: 204 }), request);
}

export async function requireOfficeGatewayAccess(request) {
  if (!isOfficeGatewayEnabled()) {
    return officeErrorResponse(404, "Office gateway is disabled", request, "not_found_error");
  }

  const apiKey = extractApiKey(request);
  if (!apiKey || !(await isValidApiKey(apiKey))) {
    return officeErrorResponse(401, "Valid Office gateway API key required", request, "authentication_error");
  }

  return null;
}

export const __test__ = {
  buildOfficeCorsHeaders,
  isTruthyEnv,
};
