import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel, DEFAULT_CAPABILITIES } from "open-sse/providers/capabilities.js";

describe("capabilities numeric-limit provenance", () => {
  it("marks a provider-table window and output as declared", () => {
    const caps = getCapabilitiesForModel("stepfun", "step-3.7-flash");
    expect(caps.contextWindow).toBe(256000);
    expect(caps.contextWindowSource).toBe("declared");
    expect(caps.maxOutput).toBe(65536);
    expect(caps.maxOutputSource).toBe("declared");
  });

  it("marks each limit separately — a table can declare one and floor the other", () => {
    const caps = getCapabilitiesForModel("stepfun", "step-3.5-flash");
    expect(caps.contextWindowSource).toBe("declared");
    expect(caps.maxOutput).toBe(DEFAULT_CAPABILITIES.maxOutput);
    expect(caps.maxOutputSource).toBe("default");
  });

  it("marks an unrecognised model as floored, not as a real 200k window", () => {
    const caps = getCapabilitiesForModel("some-provider", "brand-new-model-we-never-saw");
    expect(caps.contextWindow).toBe(DEFAULT_CAPABILITIES.contextWindow);
    expect(caps.contextWindowSource).toBe("default");
    expect(caps.maxOutputSource).toBe("default");
  });

  it("marks pattern-derived limits as declared", () => {
    const caps = getCapabilitiesForModel("kimi", "kimi-k2.5");
    expect(caps.contextWindowSource).toBe("declared");
  });

  it("marks a model-less lookup as floored", () => {
    expect(getCapabilitiesForModel("stepfun", "").contextWindowSource).toBe("default");
  });

  it("keeps provenance across memoized repeat calls", () => {
    const first = getCapabilitiesForModel("stepfun", "step-3.7-flash");
    const second = getCapabilitiesForModel("stepfun", "step-3.7-flash");
    expect(second).toEqual(first);
  });
});
