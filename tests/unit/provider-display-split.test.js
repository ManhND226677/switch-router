// Guards E1: display fields live in providersDisplay.js, merged back into AI_PROVIDERS (shape unchanged).
import { describe, it, expect } from "vitest";

const DISPLAY_FIELDS = ["name", "icon", "color"];

describe("provider display split (E1)", () => {
  it("AI_PROVIDERS entries still carry merged display + service kinds", async () => {
    const { AI_PROVIDERS } = await import("../../src/shared/constants/providers.js");
    // display + media metadata stay merged into the UI entry
    expect(AI_PROVIDERS.gemini.serviceKinds).toContain("llm");
    expect(AI_PROVIDERS.gemini.name).toBeTruthy();
  });

  it("transport stays in the engine registry, not the UI entry", async () => {
    const { PROVIDERS } = await import("open-sse/providers/index.js");
    const { AI_PROVIDERS } = await import("../../src/shared/constants/providers.js");
    expect(PROVIDERS.gemini.baseUrl).toContain("generativelanguage.googleapis.com");
    expect(AI_PROVIDERS.gemini.baseUrl).toBeUndefined();
  });

  it("display fields source from providersDisplay.js", async () => {
    const { PROVIDER_DISPLAY } = await import("../../src/shared/constants/providersDisplay.js");
    const { AI_PROVIDERS } = await import("../../src/shared/constants/providers.js");
    for (const f of DISPLAY_FIELDS) {
      expect(PROVIDER_DISPLAY.claude[f]).toBe(AI_PROVIDERS.claude[f]);
    }
  });

  it("helpers still work after split", async () => {
    const m = await import("../../src/shared/constants/providers.js");
    expect(m.getProvidersByKind("llm").length).toBeGreaterThan(0);
  });
});
