import {
  resolveStepFunCredentials,
  stepFunEndpoint,
  stepFunHeaders,
  stepFunJsonResponse,
  stepFunUpstreamResponse,
  stepFunErrorResponse,
} from "@/sse/services/stepfunProxy.js";

function fileId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}

async function getContext(request) {
  return resolveStepFunCredentials(request);
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS", "Access-Control-Allow-Headers": "*" },
  });
}

export async function GET(request, { params }) {
  const id = fileId((await params).id);
  if (!id) return stepFunJsonResponse({ error: { message: "Invalid file id", type: "invalid_request_error" } }, 400);
  const context = await getContext(request);
  if (context.error) return stepFunJsonResponse({ error: { message: context.error, type: "invalid_request_error" } }, context.status);

  const response = await fetch(`${stepFunEndpoint("files", context.credentials)}/${id}`, {
    method: "GET",
    headers: stepFunHeaders(context.credentials, { Accept: "application/json" }),
  });
  if (!response.ok) return stepFunErrorResponse(response);
  return stepFunUpstreamResponse(response);
}

export async function DELETE(request, { params }) {
  const id = fileId((await params).id);
  if (!id) return stepFunJsonResponse({ error: { message: "Invalid file id", type: "invalid_request_error" } }, 400);
  const context = await getContext(request);
  if (context.error) return stepFunJsonResponse({ error: { message: context.error, type: "invalid_request_error" } }, context.status);

  const response = await fetch(`${stepFunEndpoint("files", context.credentials)}/${id}`, {
    method: "DELETE",
    headers: stepFunHeaders(context.credentials, { Accept: "application/json" }),
  });
  if (!response.ok) return stepFunErrorResponse(response);
  return stepFunUpstreamResponse(response);
}
