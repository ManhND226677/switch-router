import { parseModelVoice, responseToBase64, throwUpstreamError } from "./_base.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";
import { resolveStepFunEndpoints } from "../../providers/stepfun.js";

const config = PROVIDER_MEDIA.stepfun?.ttsConfig || {};
const KNOWN_MODELS = [
  { id: "step-tts-2" },
  { id: "stepaudio-2.5-tts" },
  { id: "step-tts-vivid" },
];

const DEFAULT_VOICES = {
  "step-tts-2": "lively-girl",
  "step-tts-vivid": "lively-girl",
  "stepaudio-2.5-tts": "cixingnansheng",
};

const FORWARDED_FIELDS = [
  "response_format",
  "speed",
  "volume",
  "voice_label",
  "instruction",
  "sample_rate",
  "pronunciation_map",
  "stream_format",
  "markdown_filter",
  "return_url",
];

export default {
  async synthesize(text, model, credentials, responseFormat = "mp3", options = {}) {
    const token = credentials?.apiKey || credentials?.accessToken;
    if (!token) throw new Error("No StepFun API key configured");

    const parsed = parseModelVoice(model, config.defaultModel, "lively-girl", KNOWN_MODELS);
    const defaultVoice = DEFAULT_VOICES[parsed.modelId] || "lively-girl";
    const request = {
      model: parsed.modelId || config.defaultModel,
      input: text,
      voice: options.voice || (parsed.voiceId !== "lively-girl" ? parsed.voiceId : defaultVoice),
    };
    for (const field of FORWARDED_FIELDS) {
      if (field === "voice_label" && parsed.modelId === "stepaudio-2.5-tts") continue;
      if (field === "instruction" && parsed.modelId !== "stepaudio-2.5-tts") continue;
      const value = field === "response_format" ? options[field] || responseFormat : options[field];
      if (value !== undefined && value !== null && value !== "") request[field] = value;
    }

    const streamFormat = request.stream_format;
    const res = await fetch(resolveStepFunEndpoints(credentials).speech, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: streamFormat === "sse" ? "text/event-stream" : "*/*",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(request),
    });
    if (!res.ok) await throwUpstreamError(res);

    if (streamFormat === "sse") {
      return {
        success: true,
        response: new Response(res.body, {
          status: res.status,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*",
          },
        }),
      };
    }

    if (request.return_url) {
      const contentType = res.headers.get("content-type") || "application/json";
      return {
        success: true,
        response: new Response(await res.arrayBuffer(), {
          status: res.status,
          headers: { "Content-Type": contentType, "Access-Control-Allow-Origin": "*" },
        }),
      };
    }

    return responseToBase64(res, request.response_format || "mp3");
  },
};
