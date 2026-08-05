import { AI_PROVIDERS } from "@/shared/constants/providers";
import {
  resolveStepFunCredentials,
  stepFunEndpoint,
  stepFunHeaders,
  stepFunJsonResponse,
  stepFunModelFromRequest,
} from "@/sse/services/stepfunProxy.js";

// Provider → internal voices API. Edge/local-device share the generic endpoint.
const PROVIDER_API = {
  elevenlabs: (origin) => `${origin}/api/media-providers/tts/elevenlabs/voices`,
  deepgram: (origin) => `${origin}/api/media-providers/tts/deepgram/voices`,
  inworld: (origin) => `${origin}/api/media-providers/tts/inworld/voices`,
  "edge-tts": (origin) => `${origin}/api/media-providers/tts/voices?provider=edge-tts`,
  "local-device": (origin) => `${origin}/api/media-providers/tts/voices?provider=local-device`,
};

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" },
  });
}

// GET /v1/audio/voices?provider={p}[&lang=xx]
// Returns OpenAI-style list with each voice's full model id ready for /v1/audio/speech
export async function GET(request) {
  try {
    const { searchParams, origin } = new URL(request.url);
    const provider = searchParams.get("provider");
    const lang = searchParams.get("lang");

    if (provider === "stepfun") {
      const model = stepFunModelFromRequest(searchParams.get("model"), "step-tts-2");
      const context = await resolveStepFunCredentials(request, {}, model);
      if (context.error) return stepFunJsonResponse({ error: { message: context.error, type: "invalid_request_error" } }, context.status);

      const systemUrl = new URL(stepFunEndpoint("systemVoices", context.credentials));
      systemUrl.searchParams.set("model", model);
      const [systemResponse, clonedResponse] = await Promise.all([
        fetch(systemUrl, { headers: stepFunHeaders(context.credentials, { Accept: "application/json" }) }),
        fetch(stepFunEndpoint("voices", context.credentials), { headers: stepFunHeaders(context.credentials, { Accept: "application/json" }) }),
      ]);
      if (!systemResponse.ok) {
        return stepFunJsonResponse({ error: { message: `StepFun system voices request failed (${systemResponse.status})`, type: "upstream_error" } }, systemResponse.status);
      }
      const system = await systemResponse.json();
      const cloned = clonedResponse.ok ? await clonedResponse.json() : { data: [] };
      const details = system["voices-details"] || {};
      const data = (system.voices || []).map((id) => ({
        id,
        name: details[id]?.["voice-name"] || id,
        description: details[id]?.["voice-description"] || "",
        model: `stepfun/${model}/${id}`,
        source: "system",
      }));
      for (const voice of cloned.data || []) {
        const id = voice.id || voice.voice_id;
        if (!id) continue;
        data.push({ id, name: id, model: `stepfun/${model}/${id}`, source: "cloned", file_id: voice.file_id });
      }
      return Response.json({ object: "list", data }, { headers: { "Access-Control-Allow-Origin": "*" } });
    }

    if (!provider || !PROVIDER_API[provider]) {
      return Response.json(
        { error: { message: `provider must be one of: ${Object.keys(PROVIDER_API).join(", ")}`, type: "invalid_request_error" } },
        { status: 400, headers: { "Access-Control-Allow-Origin": "*" } },
      );
    }

    const baseUrl = PROVIDER_API[provider](origin);
    const url = lang ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}lang=${encodeURIComponent(lang)}` : baseUrl;
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok || data.error) {
      return Response.json(
        { error: { message: data.error || `Upstream ${res.status}`, type: "server_error" } },
        { status: res.status, headers: { "Access-Control-Allow-Origin": "*" } },
      );
    }

    // Internal API shape: { voices } when lang filter, else { byLang, languages }
    const rawVoices = lang
      ? (data.voices || [])
      : Object.values(data.byLang || {}).flatMap((l) => l.voices || []);

    // Use provider alias for /v1/audio/speech model param (matches skill convention e.g. el/, dg/, edge-tts/)
    const alias = AI_PROVIDERS[provider]?.alias || provider;
    const data_out = rawVoices.map((v) => ({
      id: v.id,
      name: v.name,
      lang: v.lang || "",
      gender: v.gender || "",
      model: `${alias}/${v.id}`,
    }));

    return Response.json({ object: "list", data: data_out }, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    return Response.json(
      { error: { message: err.message || "Failed", type: "server_error" } },
      { status: 502, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
}
