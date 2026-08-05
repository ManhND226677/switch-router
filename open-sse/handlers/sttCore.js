import { Buffer } from "node:buffer";
import { createErrorResult } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { resolveStepFunEndpoints } from "../providers/stepfun.js";

// Build auth headers from sttConfig + token
function buildAuthHeaders(cfg, token) {
  if (!token) return {};
  switch (cfg.authHeader) {
    case "bearer":     return { "Authorization": `Bearer ${token}` };
    case "token":      return { "Authorization": `Token ${token}` };
    case "x-api-key":  return { "x-api-key": token };
    case "key":        return { "Authorization": `Key ${token}` };
    default:           return { "Authorization": `Bearer ${token}` };
  }
}

// Map browser file MIME / ext → audio MIME for binary formats (deepgram/HF)
function resolveAudioContentType(file) {
  const t = (file.type || "").toLowerCase();
  if (t.startsWith("audio/")) return t;
  const name = typeof file.name === "string" ? file.name.toLowerCase() : "";
  const ext = name.includes(".") ? name.split(".").pop() : "";
  const map = { mp3: "audio/mpeg", mp4: "audio/mp4", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", webm: "audio/webm", aac: "audio/aac", opus: "audio/opus" };
  return map[ext] || "application/octet-stream";
}

function resolveStepFunAudioFormat(file) {
  const name = typeof file.name === "string" ? file.name.toLowerCase() : "";
  const ext = name.includes(".") ? name.split(".").pop() : "";
  const byExtension = {
    mp3: "mp3",
    mpeg: "mp3",
    wav: "wav",
    ogg: "ogg",
    pcm: "pcm",
  };
  if (byExtension[ext]) return byExtension[ext];

  const byMime = {
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/ogg": "ogg",
    "audio/pcm": "pcm",
    "audio/l16": "pcm",
  };
  return byMime[(file.type || "").toLowerCase()] || null;
}

async function upstreamError(res) {
  let txt = "";
  try { txt = await res.text(); } catch {}
  let msg = txt || `Upstream error (${res.status})`;
  try { const j = JSON.parse(txt); msg = j?.error?.message || j?.error || j?.message || msg; } catch {}
  return createErrorResult(res.status, typeof msg === "string" ? msg : JSON.stringify(msg));
}

// Deepgram: raw binary POST + model query param
async function transcribeDeepgram(cfg, file, model, token, formData) {
  const url = new URL(cfg.baseUrl);
  url.searchParams.set("model", model);
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("punctuate", "true");
  const lang = formData.get("language");
  if (typeof lang === "string" && lang.trim()) url.searchParams.set("language", lang.trim());
  else url.searchParams.set("detect_language", "true");

  const buf = await file.arrayBuffer();
  const res = await fetch(url, {
    method: "POST",
    headers: { ...buildAuthHeaders(cfg, token), "Content-Type": resolveAudioContentType(file) },
    body: buf,
  });
  if (!res.ok) return upstreamError(res);
  const data = await res.json();
  const text = data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
  return jsonResponse({ text });
}

// AssemblyAI: upload → submit → poll (max 120s)
async function transcribeAssemblyAI(cfg, file, model, token) {
  const auth = buildAuthHeaders(cfg, token);
  const buf = await file.arrayBuffer();
  const up = await fetch("https://api.assemblyai.com/v2/upload", {
    method: "POST", headers: { ...auth, "Content-Type": "application/octet-stream" }, body: buf,
  });
  if (!up.ok) return upstreamError(up);
  const { upload_url } = await up.json();

  const sub = await fetch(cfg.baseUrl, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ audio_url: upload_url, speech_models: [model], language_detection: true }),
  });
  if (!sub.ok) return upstreamError(sub);
  const { id } = await sub.json();

  const start = Date.now();
  while (Date.now() - start < 120_000) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(`${cfg.baseUrl}/${id}`, { headers: auth });
    if (!poll.ok) continue;
    const r = await poll.json();
    if (r.status === "completed") return jsonResponse({ text: r.text || "" });
    if (r.status === "error") return createErrorResult(500, r.error || "AssemblyAI failed");
  }
  return createErrorResult(504, "AssemblyAI timeout after 120s");
}

// Nvidia NIM: multipart, normalize response
async function transcribeNvidia(cfg, file, model, token) {
  const fd = new FormData();
  fd.append("file", file, file.name || "audio.wav");
  fd.append("model", model);
  const res = await fetch(cfg.baseUrl, { method: "POST", headers: buildAuthHeaders(cfg, token), body: fd });
  if (!res.ok) return upstreamError(res);
  const data = await res.json();
  return jsonResponse({ text: data.text || data.transcript || "" });
}

// Gemini: generateContent with inline_data audio + transcription prompt
async function transcribeGemini(cfg, file, model, token, formData) {
  const buf = await file.arrayBuffer();
  const b64 = Buffer.from(buf).toString("base64");
  const mime = resolveAudioContentType(file);
  const lang = formData.get("language");
  const userPrompt = formData.get("prompt");
  let promptText = userPrompt && typeof userPrompt === "string" && userPrompt.trim()
    ? userPrompt.trim()
    : "Generate a transcript of the speech. Return only the transcribed text, no commentary.";
  if (typeof lang === "string" && lang.trim()) promptText += ` Language: ${lang.trim()}.`;

  const url = `${cfg.baseUrl}/${model}:generateContent?key=${token}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: promptText }, { inline_data: { mime_type: mime, data: b64 } }] }],
    }),
  });
  if (!res.ok) return upstreamError(res);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("") || "";
  return jsonResponse({ text });
}

async function transcribeStepFun(cfg, file, model, token, formData) {
  const bytes = await file.arrayBuffer();
  const type = resolveStepFunAudioFormat(file);
  if (!type) return createErrorResult(HTTP_STATUS.BAD_REQUEST, "StepFun ASR supports ogg, mp3, wav, or pcm audio files");
  const language = formData.get("language");
  const enableItn = formData.get("enable_itn");
  const audioInput = {
    transcription: {
      model: model || "stepaudio-2.5-asr",
      ...(typeof language === "string" && language.trim() ? { language: language.trim() } : {}),
      ...(enableItn !== null && enableItn !== "" ? { enable_itn: enableItn !== "false" } : {}),
    },
    format: { type },
  };
  const res = await fetch(cfg.baseUrl, {
    method: "POST",
    headers: {
      ...buildAuthHeaders(cfg, token),
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      audio: {
        data: Buffer.from(bytes).toString("base64"),
        input: audioInput,
      },
    }),
  });
  if (!res.ok) return upstreamError(res);

  const raw = await res.text();
  let transcript = "";
  let deltaTranscript = "";
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const value = line.slice(5).trim();
    if (!value || value === "[DONE]") continue;
    try {
      const event = JSON.parse(value);
      if (event.type === "transcript.text.done" && typeof event.text === "string") transcript = event.text;
      else if (event.type === "transcript.text.delta" && typeof event.delta === "string") deltaTranscript += event.delta;
      if (event.type === "error") return createErrorResult(HTTP_STATUS.BAD_GATEWAY, event.message || "StepFun ASR failed");
    } catch {
      // Ignore non-JSON SSE comments and provider keep-alives.
    }
  }
  return jsonResponse({ text: transcript || deltaTranscript });
}

// HuggingFace: POST raw binary to {baseUrl}/{model_id}
async function transcribeHuggingFace(cfg, file, model, token) {
  if (model.includes("..") || model.includes("//")) return createErrorResult(400, "Invalid model ID");
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/${model}`;
  const buf = await file.arrayBuffer();
  const res = await fetch(url, {
    method: "POST",
    headers: { ...buildAuthHeaders(cfg, token), "Content-Type": resolveAudioContentType(file) },
    body: buf,
  });
  if (!res.ok) return upstreamError(res);
  const data = await res.json();
  return jsonResponse({ text: data.text || "" });
}

// Default: OpenAI/Groq/Whisper-compatible multipart
async function transcribeOpenAICompatible(cfg, file, model, token, formData) {
  const fd = new FormData();
  fd.append("file", file, file.name || "audio.wav");
  fd.append("model", model);
  for (const k of ["language", "prompt", "response_format", "temperature"]) {
    const v = formData.get(k);
    if (v !== null && v !== undefined && v !== "") fd.append(k, v);
  }
  const res = await fetch(cfg.baseUrl, { method: "POST", headers: buildAuthHeaders(cfg, token), body: fd });
  if (!res.ok) return upstreamError(res);
  const ct = res.headers.get("content-type") || "application/json";
  const txt = await res.text();
  return { success: true, response: new Response(txt, { status: 200, headers: { "Content-Type": ct, "Access-Control-Allow-Origin": "*" } }) };
}

function jsonResponse(obj) {
  return {
    success: true,
    response: new Response(JSON.stringify(obj), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    }),
  };
}

/**
 * STT core handler — dispatch by sttConfig.format.
 * @returns {Promise<{success, response, status?, error?}>}
 */
export async function handleSttCore({ provider, model, formData, credentials, sttConfig }) {
  const file = formData.get("file");
  if (!file) return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: file");

  const cfg = provider === "stepfun"
    ? { ...sttConfig, baseUrl: resolveStepFunEndpoints(credentials).asr }
    : sttConfig;
  if (!cfg) return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not support STT`);

  const token = cfg.authType === "none" ? null : (credentials?.apiKey || credentials?.accessToken);
  if (cfg.authType !== "none" && !token) {
    return createErrorResult(HTTP_STATUS.UNAUTHORIZED, `No credentials for STT provider: ${provider}`);
  }

  try {
    switch (cfg.format) {
      case "deepgram":        return await transcribeDeepgram(cfg, file, model, token, formData);
      case "assemblyai":      return await transcribeAssemblyAI(cfg, file, model, token);
      case "nvidia-asr":      return await transcribeNvidia(cfg, file, model, token);
      case "huggingface-asr": return await transcribeHuggingFace(cfg, file, model, token);
      case "gemini-stt":      return await transcribeGemini(cfg, file, model, token, formData);
      case "stepfun-asr-sse": return await transcribeStepFun(cfg, file, model, token, formData);
      default:                return await transcribeOpenAICompatible(cfg, file, model, token, formData);
    }
  } catch (err) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, err.message || "STT request failed");
  }
}
