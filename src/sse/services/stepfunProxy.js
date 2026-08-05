import { getProviderCredentials } from "../services/auth.js";
import { checkAndRefreshToken } from "../services/tokenRefresh.js";
import { resolveConnectionSelector } from "../services/connectionSelector.js";
import { resolveStepFunEndpoints } from "open-sse/providers/stepfun.js";
import { getStepFunToken, resolveStepFunModel, stepFunAuthHeaders } from "./stepfun.js";

export async function resolveStepFunCredentials(request, body = {}, model = null) {
  const selection = resolveConnectionSelector(request, body);
  const provider = selection.providerHint || "stepfun";
  if (provider !== "stepfun") {
    return { error: `Provider '${provider}' is not supported by this StepFun route.`, status: 400 };
  }

  const credentials = await getProviderCredentials(
    "stepfun",
    null,
    model,
    { preferredConnectionId: selection.preferredConnectionId },
  );
  if (!credentials || credentials.allRateLimited) {
    return {
      error: credentials?.lastError || "No active credentials for provider: stepfun",
      status: credentials?.allRateLimited ? 503 : 400,
    };
  }

  return {
    credentials: await checkAndRefreshToken("stepfun", credentials),
    selection,
  };
}

export function stepFunEndpoint(name, credentials = {}) {
  return resolveStepFunEndpoints(credentials)[name];
}

export function stepFunUrl(pathOrUrl, credentials = {}) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${stepFunEndpoint("files", credentials).replace(/\/files$/, "")}/${String(pathOrUrl).replace(/^\/+/, "")}`;
}

export function stepFunHeaders(credentials, extra = {}) {
  const token = getStepFunToken(credentials);
  return stepFunAuthHeaders(credentials, extra);
}

export function stepFunModelFromRequest(value, fallback = "step-3.7-flash") {
  return resolveStepFunModel(value, fallback);
}

export function stepFunJsonResponse(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: { "Access-Control-Allow-Origin": "*", ...headers },
  });
}

export function stepFunUpstreamResponse(response, headers = {}) {
  const passThrough = new Headers();
  for (const name of ["content-type", "content-length", "content-disposition", "cache-control", "etag"]) {
    const value = response.headers.get(name);
    if (value) passThrough.set(name, value);
  }
  passThrough.set("Access-Control-Allow-Origin", "*");
  for (const [name, value] of Object.entries(headers)) {
    if (value != null) passThrough.set(name, String(value));
  }
  return new Response(response.body, { status: response.status, headers: passThrough });
}

export async function stepFunErrorResponse(response) {
  const text = await response.text().catch(() => "");
  let message = text || `StepFun request failed (${response.status})`;
  try {
    const body = JSON.parse(text);
    message = body?.error?.message || body?.message || message;
  } catch {}
  return stepFunJsonResponse({ error: { message, type: "upstream_error" } }, response.status);
}
