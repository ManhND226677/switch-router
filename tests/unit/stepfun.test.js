import { afterEach, describe, expect, it, vi } from "vitest";

import { PROVIDERS, PROVIDER_MEDIA, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { StepFunExecutor } from "../../open-sse/executors/stepfun.js";
import {
  STEPFUN_BASE_URL,
  STEPFUN_ENDPOINTS,
  STEPFUN_PAYG_ENDPOINTS,
  STEPFUN_TOKEN_PLAN_BASE_URL,
  getStepFunStaticCatalog,
  resolveStepFunApiMode,
  resolveStepFunEndpoints,
} from "../../open-sse/providers/stepfun.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import imageAdapter from "../../open-sse/handlers/imageProviders/stepfun.js";
import ttsAdapter from "../../open-sse/handlers/ttsProviders/stepfun.js";
import { handleSttCore } from "../../open-sse/handlers/sttCore.js";
import { fetchStepFunModels } from "../../src/sse/services/stepfun.js";
import { resolveConnectionSelector, modelForProvider } from "../../src/sse/services/connectionSelector.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("StepFun provider registration", () => {
  it("targets the dedicated Step Plan API base URL", () => {
    expect(STEPFUN_BASE_URL).toBe(STEPFUN_TOKEN_PLAN_BASE_URL);
    expect(STEPFUN_ENDPOINTS.chat).toBe("https://api.stepfun.ai/step_plan/v1/chat/completions");
    expect(STEPFUN_ENDPOINTS.models).toBe("https://api.stepfun.ai/step_plan/v1/models");
    expect(STEPFUN_ENDPOINTS.messages).toBe("https://api.stepfun.ai/step_plan/v1/messages");
    expect(STEPFUN_ENDPOINTS.realtime).toBe("wss://api.stepfun.ai/step_plan/v1/realtime");
  });

  it("selects the billing system per connection", () => {
    expect(resolveStepFunApiMode({})).toBe("token-plan");
    expect(resolveStepFunEndpoints({ apiMode: "payg" }).chat).toBe(STEPFUN_PAYG_ENDPOINTS.chat);
    expect(resolveStepFunEndpoints({ providerSpecificData: { apiMode: "token_plan" } }).chat).toBe(STEPFUN_ENDPOINTS.chat);
  });

  it("registers chat, media and static model metadata", () => {
    expect(PROVIDERS.stepfun.baseUrl).toBe(STEPFUN_ENDPOINTS.chat);
    expect(PROVIDERS.stepfun.validateUrl).toBe(STEPFUN_ENDPOINTS.models);
    expect(AI_PROVIDERS.stepfun).toMatchObject({
      defaultApiMode: "token-plan",
      apiModes: expect.arrayContaining([
        expect.objectContaining({ id: "payg" }),
        expect.objectContaining({ id: "token-plan" }),
      ]),
    });
    expect(PROVIDER_MEDIA.stepfun).toMatchObject({
      serviceKinds: expect.arrayContaining(["llm", "image", "tts", "stt", "realtime"]),
    });
    expect(PROVIDER_MODELS.stepfun.map((model) => model.id)).toEqual(
      getStepFunStaticCatalog().map((model) => model.id),
    );
    expect(getExecutor("stepfun")).toBeInstanceOf(StepFunExecutor);
  });

  it("exposes documented reasoning controls for both Step 3.5 variants", () => {
    expect(getCapabilitiesForModel("stepfun", "step-3.5-flash")).toMatchObject({
      reasoning: true,
      thinkingFormat: "step",
      contextWindow: 256000,
    });
    expect(getThinkingLevels("stepfun", "step-3.5-flash")).toEqual(["none", "low", "medium", "high"]);
    expect(getThinkingLevels("stepfun", "step-3.5-flash-2603")).toEqual(["low", "high"]);
  });
});

describe("StepFunExecutor", () => {
  const executor = new StepFunExecutor();

  it("routes OpenAI, Claude and Responses clients to their native endpoints", () => {
    expect(executor.buildUrl("step-3.7-flash", true, 0, {})).toBe(STEPFUN_ENDPOINTS.chat);
    expect(executor.buildUrl("step-3.7-flash", true, 0, {
      runtimeTransport: { baseUrl: STEPFUN_ENDPOINTS.messages, format: "claude" },
    })).toBe(STEPFUN_ENDPOINTS.messages);
    expect(executor.buildUrl("step-3.7-flash", false, 0, {
      runtimeTransport: { baseUrl: STEPFUN_ENDPOINTS.responses, format: "openai-responses" },
    })).toBe(STEPFUN_ENDPOINTS.responses);

    expect(executor.buildUrl("step-3.7-flash", true, 0, {
      providerSpecificData: { apiMode: "payg" },
      runtimeTransport: { format: "openai" },
    })).toBe(STEPFUN_PAYG_ENDPOINTS.chat);
  });

  it("maps reasoning effort and strips unsupported Claude artifacts", () => {
    const claudeBody = executor.transformRequest("step-3.7-flash", {
      model: "step-3.7-flash",
      max_output_tokens: 2048,
      reasoning_effort: "high",
      anthropic_version: "2023-06-01",
      messages: [{
        role: "assistant",
        content: [
          { type: "thinking", thinking: "internal", signature: "opaque" },
          { type: "text", text: "visible", cache_control: { type: "ephemeral" } },
        ],
      }],
    }, true, { runtimeTransport: { format: "claude" } });

    expect(claudeBody).toMatchObject({ max_tokens: 2048, output_config: { effort: "high" } });
    expect(claudeBody.max_output_tokens).toBeUndefined();
    expect(claudeBody.reasoning_effort).toBeUndefined();
    expect(claudeBody.anthropic_version).toBeUndefined();
    expect(claudeBody.messages[0].content).toEqual([{ type: "text", text: "visible" }]);

    const responsesBody = executor.transformRequest("step-3.7-flash", {
      input: "hello",
      reasoning_effort: "low",
      output_config: { effort: "medium" },
    }, false, { runtimeTransport: { format: "openai-responses" } });
    expect(responsesBody.reasoning).toEqual({ effort: "medium" });
    expect(responsesBody.output_config).toBeUndefined();
    expect(responsesBody.reasoning_effort).toBeUndefined();
  });
});

describe("StepFun model catalog", () => {
  it("uses the static catalog when the live endpoint is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    const result = await fetchStepFunModels({ apiKey: "step-key" });

    expect(result.warning).toContain("static catalog");
    expect(result.models.map((model) => model.id)).toEqual(
      getStepFunStaticCatalog().map((model) => model.id),
    );
  });

  it("merges live models with catalog-only media models", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "step-3.7-flash", name: "Live Step 3.7" }, { id: "stepaudio-2.5-realtime" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const result = await fetchStepFunModels({ apiKey: "step-key" });

    expect(result.models[0]).toMatchObject({ id: "step-3.7-flash", name: "Live Step 3.7", availability: "available" });
    expect(result.models.some((model) => model.id === "step-tts-2" && model.availability === "catalog-only")).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      STEPFUN_ENDPOINTS.models,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer step-key" }) }),
    );
  });

  it("uses the pay-as-you-go models endpoint for a pay-as-you-go connection", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "step-3.7-flash" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await fetchStepFunModels({ apiKey: "step-key", providerSpecificData: { apiMode: "payg" } });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      STEPFUN_PAYG_ENDPOINTS.models,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer step-key" }) }),
    );
  });
});

describe("StepFun media adapters", () => {
  it("builds JSON generation and multipart edit requests", () => {
    expect(imageAdapter.buildUrl("step-image-edit-2", {}, {})).toBe(STEPFUN_ENDPOINTS.images);
    expect(imageAdapter.buildBody("step-image-edit-2", { prompt: "a tree", size: "1024x1024" })).toEqual({
      model: "step-image-edit-2",
      prompt: "a tree",
      size: "1024x1024",
    });

    const image = new File([new Uint8Array([1, 2, 3])], "source.png", { type: "image/png" });
    const form = imageAdapter.buildBody("step-image-edit-2", { image, prompt: "make it red" });
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("model")).toBe("step-image-edit-2");
    expect(form.get("prompt")).toBe("make it red");
    expect(form.get("image")).toBeInstanceOf(File);
    expect(imageAdapter.buildUrl("step-image-edit-2", {}, { image })).toBe(STEPFUN_ENDPOINTS.imageEdits);
    expect(imageAdapter.buildUrl("step-image-edit-2", { providerSpecificData: { apiMode: "payg" } }, {})).toBe(STEPFUN_PAYG_ENDPOINTS.images);
    expect(imageAdapter.buildUrl("step-image-edit-2", { providerSpecificData: { apiMode: "payg" } }, { image })).toBe(STEPFUN_PAYG_ENDPOINTS.imageEdits);
  });

  it("forwards StepFun TTS options and decodes binary audio", async () => {
    const audio = new Uint8Array(128).fill(7);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(audio, {
      status: 200,
      headers: { "Content-Type": "audio/mpeg" },
    }));

    const result = await ttsAdapter.synthesize(
      "hello",
      "step-tts-2/lively-girl",
      { apiKey: "step-key" },
      "mp3",
      { speed: 1.1, volume: 0.8, instruction: "warm" },
    );

    expect(result.format).toBe("mp3");
    expect(result.base64).toBe(Buffer.from(audio).toString("base64"));
    const [, request] = globalThis.fetch.mock.calls[0];
    expect(globalThis.fetch.mock.calls[0][0]).toBe(STEPFUN_ENDPOINTS.speech);
    expect(JSON.parse(request.body)).toMatchObject({
      model: "step-tts-2",
      voice: "lively-girl",
      speed: 1.1,
      volume: 0.8,
    });
    expect(JSON.parse(request.body).instruction).toBeUndefined();
  });

  it("uses the documented default voice and omits incompatible TTS fields", async () => {
    const audio = new Uint8Array(128).fill(7);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(audio, {
      status: 200,
      headers: { "Content-Type": "audio/mpeg" },
    }));

    await ttsAdapter.synthesize("hello", "stepaudio-2.5-tts", { apiKey: "step-key" }, "mp3", {
      voice_label: { emotion: "Happy" },
      instruction: "warm",
    });

    const [, request] = globalThis.fetch.mock.calls[0];
    const body = JSON.parse(request.body);
    expect(body.voice).toBe("cixingnansheng");
    expect(body.instruction).toBe("warm");
    expect(body.voice_label).toBeUndefined();
  });

  it("sends the StepFun ASR envelope and rejects unsupported audio formats", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      'data: {"type":"transcript.text.delta","delta":"hello"}\n\ndata: {"type":"transcript.text.done","text":"hello world"}\n\n',
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    ));
    const file = new File([new Uint8Array([1, 2, 3])], "speech.mp3", { type: "audio/mpeg" });
    const form = new FormData();
    form.set("file", file);
    form.set("language", "en");

    const result = await handleSttCore({
      provider: "stepfun",
      model: "stepaudio-2.5-asr",
      formData: form,
      credentials: { apiKey: "step-key" },
      sttConfig: { baseUrl: STEPFUN_ENDPOINTS.asr, authType: "apikey", authHeader: "bearer", format: "stepfun-asr-sse" },
    });
    expect(result.success).toBe(true);
    expect(await result.response.json()).toEqual({ text: "hello world" });
    expect(globalThis.fetch.mock.calls[0][0]).toBe(STEPFUN_ENDPOINTS.asr);
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toMatchObject({
      audio: { input: { transcription: { model: "stepaudio-2.5-asr", language: "en" }, format: { type: "mp3" } } },
    });

    const unsupported = new FormData();
    unsupported.set("file", new File([new Uint8Array([1])], "speech.m4a", { type: "audio/mp4" }));
    const rejected = await handleSttCore({
      provider: "stepfun",
      model: "stepaudio-2.5-asr",
      formData: unsupported,
      credentials: { apiKey: "step-key" },
      sttConfig: { baseUrl: STEPFUN_ENDPOINTS.asr, authType: "apikey", authHeader: "bearer", format: "stepfun-asr-sse" },
    });
    expect(rejected.status).toBe(400);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("connection selectors", () => {
  it("accepts headers, query parameters and provider-prefixed model names", () => {
    const request = new Request("https://router.test/v1/audio/speech?connection_id=query-connection", {
      headers: { "x-connection-id": "header-connection", "x-provider": "stepfun" },
    });
    expect(resolveConnectionSelector(request, { provider: "ignored" })).toEqual({
      preferredConnectionId: "header-connection",
      providerHint: "stepfun",
    });
    expect(modelForProvider("step-tts-2", "stepfun")).toBe("stepfun/step-tts-2");
    expect(modelForProvider("stepfun/step-tts-2", "stepfun")).toBe("stepfun/step-tts-2");
  });
});
