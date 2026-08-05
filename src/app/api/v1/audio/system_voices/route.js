import {
  resolveStepFunCredentials,
  stepFunEndpoint,
  stepFunHeaders,
  stepFunJsonResponse,
  stepFunUpstreamResponse,
  stepFunErrorResponse,
  stepFunModelFromRequest,
} from "@/sse/services/stepfunProxy.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" },
  });
}

export async function GET(request) {
  const url = new URL(request.url);
  const model = stepFunModelFromRequest(url.searchParams.get("model"), "step-tts-2");
  const context = await resolveStepFunCredentials(request, {}, model);
  if (context.error) return stepFunJsonResponse({ error: { message: context.error, type: "invalid_request_error" } }, context.status);

  const upstream = new URL(stepFunEndpoint("systemVoices", context.credentials));
  upstream.searchParams.set("model", model);
  const response = await fetch(upstream, {
    method: "GET",
    headers: stepFunHeaders(context.credentials, { Accept: "application/json" }),
  });
  if (!response.ok) return stepFunErrorResponse(response);
  return stepFunUpstreamResponse(response);
}
