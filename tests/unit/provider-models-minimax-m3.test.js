/**
 * Unit tests verifying MiniMax-M3 is registered as a first-class
 * built-in model for both the `minimax` (international) and
 * `minimax` provider, with `targetFormat: "claude"`.
 *
 * Run: cd tests && NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run tests/unit/provider-models-minimax-m3.test.js --reporter=verbose
 */

import { describe, it, expect } from "vitest";
import { PROVIDER_MODELS, getModelsByProviderId } from "../../open-sse/config/providerModels.js";

describe("MiniMax-M3 model registration", () => {
  it("includes MiniMax-M3 in PROVIDER_MODELS.minimax", () => {
    const models = PROVIDER_MODELS.minimax || [];
    const m3 = models.find((m) => m.id === "MiniMax-M3");
    expect(m3).toBeDefined();
    expect(m3).toMatchObject({
      id: "MiniMax-M3",
      name: "MiniMax M3",
      targetFormat: "claude",
    });
  });

  it("exposes MiniMax-M3 through getModelsByProviderId", () => {
    const intlModels = getModelsByProviderId("minimax");

    expect(intlModels.some((m) => m.id === "MiniMax-M3")).toBe(true);
  });

  it("does not regress the existing M2.7 / M2.5 / M2.1 entries", () => {
    const intlIds = (PROVIDER_MODELS.minimax || []).map((m) => m.id);
    for (const id of ["MiniMax-M2.7", "MiniMax-M2.5", "MiniMax-M2.1"]) {
      expect(intlIds).toContain(id);
    }
  });
});
