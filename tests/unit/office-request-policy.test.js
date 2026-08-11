import { afterEach, describe, expect, it } from "vitest";
import {
  OFFICE_MESSAGES_ENDPOINT,
  OFFICE_POWERPOINT_RUNTIME_GUARDRAIL,
  appendOfficePowerPointRuntimeGuardrail,
  getOfficeRequestPolicy,
  getRequestPromptInjectionFlags,
  routeOfficeRequestModel,
} from "../../src/sse/services/officeRequestPolicy.js";

const originalOfficeModelIds = process.env.OFFICE_MODEL_IDS;

afterEach(() => {
  if (originalOfficeModelIds === undefined) delete process.env.OFFICE_MODEL_IDS;
  else process.env.OFFICE_MODEL_IDS = originalOfficeModelIds;
});

describe("Office request prompt policy", () => {
  it("disables Caveman and Ponytail only for the Office messages endpoint", () => {
    expect(getRequestPromptInjectionFlags({
      cavemanEnabled: true,
      ponytailEnabled: true,
    }, OFFICE_MESSAGES_ENDPOINT)).toEqual({
      cavemanEnabled: false,
      ponytailEnabled: false,
    });
  });

  it("preserves the global flags for non-Office endpoints", () => {
    expect(getRequestPromptInjectionFlags({
      cavemanEnabled: true,
      ponytailEnabled: false,
    }, "/v1/chat/completions")).toEqual({
      cavemanEnabled: true,
      ponytailEnabled: false,
    });
  });

  it("disables every optional content transform for Office while retaining them elsewhere", () => {
    const settings = {
      rtkEnabled: true,
      cavemanEnabled: true,
      ponytailEnabled: true,
      pxpipeEnabled: true,
    };

    expect(getOfficeRequestPolicy(settings, OFFICE_MESSAGES_ENDPOINT)).toEqual({
      isOfficeRequest: true,
      preserveClientPayload: true,
      rtkEnabled: false,
      cavemanEnabled: false,
      ponytailEnabled: false,
      pxpipeEnabled: false,
    });
    expect(getOfficeRequestPolicy(settings, "/v1/chat/completions")).toEqual({
      isOfficeRequest: false,
      preserveClientPayload: false,
      rtkEnabled: true,
      cavemanEnabled: true,
      ponytailEnabled: true,
      pxpipeEnabled: true,
    });
  });

  it("adds the PowerPoint guardrail without mutating Office-provided context", () => {
    const officeBody = {
      model: "claude-sonnet-5",
      system: [{ type: "text", text: "Office-owned instructions" }],
      messages: [{ role: "user", content: "Inspect this slide" }],
      tools: [{ name: "run_office_script", input_schema: { type: "object" } }],
    };
    const original = structuredClone(officeBody);

    const guarded = appendOfficePowerPointRuntimeGuardrail(officeBody, OFFICE_MESSAGES_ENDPOINT);

    expect(officeBody).toEqual(original);
    expect(guarded).not.toBe(officeBody);
    expect(guarded.messages).toBe(officeBody.messages);
    expect(guarded.tools).toBe(officeBody.tools);
    expect(guarded.system).toEqual([
      original.system[0],
      { type: "text", text: OFFICE_POWERPOINT_RUNTIME_GUARDRAIL },
    ]);
    expect(appendOfficePowerPointRuntimeGuardrail(guarded, OFFICE_MESSAGES_ENDPOINT)).toBe(guarded);
  });

  it("does not add the Office guardrail to another endpoint", () => {
    const body = { system: "Original context" };
    expect(appendOfficePowerPointRuntimeGuardrail(body, "/v1/messages")).toBe(body);
  });

  it("routes an auxiliary Office model through the first allowlisted combo without mutating the request", () => {
    process.env.OFFICE_MODEL_IDS = "claude-sonnet-5";
    const body = {
      model: "zyl/zyloo/claude-haiku-4-5",
      messages: [{ role: "user", content: "Office-owned content" }],
    };
    const original = structuredClone(body);

    const routed = routeOfficeRequestModel(body, OFFICE_MESSAGES_ENDPOINT);

    expect(body).toEqual(original);
    expect(routed).not.toBe(body);
    expect(routed).toEqual({ ...original, model: "claude-sonnet-5" });
    expect(routed.messages).toBe(body.messages);
  });

  it("leaves allowed Office models and non-Office requests unchanged", () => {
    process.env.OFFICE_MODEL_IDS = "claude-sonnet-5";
    const allowed = { model: "claude-sonnet-5" };
    const otherEndpoint = { model: "zyl/zyloo/claude-haiku-4-5" };

    expect(routeOfficeRequestModel(allowed, OFFICE_MESSAGES_ENDPOINT)).toBe(allowed);
    expect(routeOfficeRequestModel(otherEndpoint, "/v1/messages")).toBe(otherEndpoint);
  });
});
