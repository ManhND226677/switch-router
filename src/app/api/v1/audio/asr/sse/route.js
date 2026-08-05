import {
  resolveStepFunCredentials,
  stepFunEndpoint,
  stepFunHeaders,
  stepFunJsonResponse,
  stepFunUpstreamResponse,
  stepFunErrorResponse,
  stepFunModelFromRequest,
} from "@/sse/services/stepfunProxy.js";

export const maxDuration = 300;

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

  const model = stepFunModelFromRequest(body?.audio?.input?.transcription?.model || body?.model, "stepaudio-2.5-asr");
  const context = await resolveStepFunCredentials(request, body, model);
  if (context.error) return stepFunJsonResponse({ error: { message: context.error, type: "invalid_request_error" } }, context.status);
  if (!body?.audio?.data) {
    return stepFunJsonResponse({ error: { message: "Missing audio.data", type: "invalid_request_error" } }, 400);
  }

  const forwardBody = {
    audio: {
      ...body.audio,
      input: {
        ...(body.audio.input || {}),
        transcription: {
          ...(body.audio.input?.transcription || {}),
          model,
        },
      },
    },
  };
  const response = await fetch(stepFunEndpoint("asr", context.credentials), {
    method: "POST",
    headers: stepFunHeaders(context.credentials, { "Content-Type": "application/json", Accept: "text/event-stream" }),
    body: JSON.stringify(forwardBody),
    signal: request.signal,
  });
  if (!response.ok) return stepFunErrorResponse(response);
  return stepFunUpstreamResponse(response, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
}
