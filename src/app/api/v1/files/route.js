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
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "*" },
  });
}

export async function GET(request) {
  const context = await resolveStepFunCredentials(request);
  if (context.error) return stepFunJsonResponse({ error: { message: context.error, type: "invalid_request_error" } }, context.status);

  const response = await fetch(stepFunEndpoint("files", context.credentials), {
    method: "GET",
    headers: stepFunHeaders(context.credentials, { Accept: "application/json" }),
  });
  if (!response.ok) return stepFunErrorResponse(response);
  return stepFunUpstreamResponse(response);
}

export async function POST(request) {
  const context = await resolveStepFunCredentials(request);
  if (context.error) return stepFunJsonResponse({ error: { message: context.error, type: "invalid_request_error" } }, context.status);

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return stepFunJsonResponse({ error: { message: "Invalid multipart form data", type: "invalid_request_error" } }, 400);
  }
  if (!formData.get("purpose")) formData.set("purpose", "storage");

  const response = await fetch(stepFunEndpoint("files", context.credentials), {
    method: "POST",
    headers: stepFunHeaders(context.credentials),
    body: formData,
  });
  if (!response.ok) return stepFunErrorResponse(response);
  return stepFunUpstreamResponse(response);
}
