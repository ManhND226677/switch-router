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
  });

  it("selects the billing system per connection", () => {
    expect(resolveStepFunApiMode({})).toBe("token-plan");
    expect(resolveStepFunEndpoints({ apiMode: "payg" }).chat).toBe(STEPFUN_PAYG_ENDPOINTS.chat);
    expect(resolveStepFunEndpoints({ providerSpecificData: { apiMode: "token_plan" } }).chat).toBe(STEPFUN_ENDPOINTS.chat);
  });

  it("registers chat and static model metadata", () => {
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
      modelsFetcher: { url: STEPFUN_ENDPOINTS.models, type: "openai" },
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

  it("merges live models with catalog-only models", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "step-3.7-flash", name: "Live Step 3.7" }, { id: "stepaudio-2.5-realtime" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const result = await fetchStepFunModels({ apiKey: "step-key" });

    expect(result.models[0]).toMatchObject({ id: "step-3.7-flash", name: "Live Step 3.7", availability: "available" });
    expect(result.models.some((model) => model.id === "stepaudio-2.5-chat" && model.availability === "catalog-only")).toBe(true);
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
