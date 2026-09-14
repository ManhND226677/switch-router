import {
  resolveStepFunCredentials,
  stepFunEndpoint,
  stepFunHeaders,
  stepFunJsonResponse,
  stepFunUpstreamResponse,
  stepFunErrorResponse,
} from "@/sse/services/stepfunProxy.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" },
  });
}

export async function GET(request) {
  const context = await resolveStepFunCredentials(request);
  if (context.error) return stepFunJsonResponse({ error: { message: context.error, type: "invalid_request_error" } }, context.status);

  const response = await fetch(stepFunEndpoint("accounts", context.credentials), {
    method: "GET",
    headers: stepFunHeaders(context.credentials, { Accept: "application/json" }),
  });
  if (!response.ok) return stepFunErrorResponse(response);
  return stepFunUpstreamResponse(response);
}
