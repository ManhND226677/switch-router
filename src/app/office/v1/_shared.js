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
  // The Office add-in talks to us through the Anthropic browser SDK, which always
  // adds these. A preflight that omits any requested header fails the whole fetch
  // and the taskpane only reports "Unable to connect".
  "anthropic-dangerous-direct-browser-access",
  "x-stainless-lang",
  "x-stainless-package-version",
  "x-stainless-os",
  "x-stainless-arch",
  "x-stainless-runtime",
  "x-stainless-runtime-version",
  "x-stainless-retry-count",
  "x-stainless-timeout",
  "x-stainless-helper-method",
  "user-agent",
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

// Echo whatever the browser asked for on top of the static allowlist: the Anthropic
// SDK version bundled in the taskpane decides its own header set, and a preflight
// that misses even one requested header fails the whole fetch.
function resolveAllowedHeaders(request) {
  const requested = String(request?.headers?.get?.("access-control-request-headers") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const seen = new Set();
  const allowed = [];
  for (const name of [...OFFICE_ALLOWED_HEADERS, ...requested]) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    allowed.push(key);
  }

  return allowed.join(", ");
}

function buildOfficeCorsHeaders(request) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": resolveAllowedHeaders(request),
    "Access-Control-Max-Age": "600",
    Vary: "Origin, Access-Control-Request-Headers",
  };

  const origin = request?.headers?.get?.("origin");
  if (!origin || origin === OFFICE_GATEWAY_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = OFFICE_GATEWAY_ORIGIN;
  }

  // Chromium Private Network Access: a public HTTPS page (the taskpane) calling a
  // loopback gateway must get this on the preflight or the request never leaves.
  if (request?.headers?.get?.("access-control-request-private-network") === "true") {
    headers["Access-Control-Allow-Private-Network"] = "true";
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
  resolveAllowedHeaders,
  isTruthyEnv,
};
