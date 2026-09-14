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
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "*" },
  });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return stepFunJsonResponse({ error: { message: "Invalid JSON body", type: "invalid_request_error" } }, 400);
  }
  const model = stepFunModelFromRequest(body.model);
  const context = await resolveStepFunCredentials(request, body, model);
  if (context.error) return stepFunJsonResponse({ error: { message: context.error, type: "invalid_request_error" } }, context.status);

  const forwardBody = { ...body, model };
  delete forwardBody.provider;
  delete forwardBody.connection_id;
  const response = await fetch(stepFunEndpoint("tokenCount", context.credentials), {
    method: "POST",
    headers: stepFunHeaders(context.credentials, { "Content-Type": "application/json", Accept: "application/json" }),
    body: JSON.stringify(forwardBody),
  });
  if (!response.ok) return stepFunErrorResponse(response);
  return stepFunUpstreamResponse(response);
}
