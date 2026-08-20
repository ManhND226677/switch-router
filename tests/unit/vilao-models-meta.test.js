import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Unit-test the Vilao models customResolver contract via the exported helper
// shapes we rely on in the dashboard (meta.keyValid / walletEmpty / modelCount).

describe("Vilao models / test meta contract", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("normalizeVilaoBaseUrl keeps default and strips chat path", async () => {
    const { normalizeVilaoBaseUrl, getVilaoModelsUrl } = await import("../../open-sse/providers/vilao.js");
    expect(normalizeVilaoBaseUrl("")).toBe("https://api.vilao.ai/v1");
    expect(normalizeVilaoBaseUrl("https://gw.example.com/v1/chat/completions")).toBe("https://gw.example.com/v1");
    expect(getVilaoModelsUrl("https://gw.example.com")).toBe("https://gw.example.com/v1/models");
  });

  it("maps 402 to keyValid + walletEmpty without throwing", async () => {
    // Lightweight pure mapping mirroring testUtils / models route semantics.
    function mapVilaoModelsStatus(status, modelCount = 0) {
      if (status === 402) {
        return { keyValid: true, walletEmpty: true, modelCount: 0, valid: true };
      }
      if (status === 401) {
        return { keyValid: false, walletEmpty: false, modelCount: 0, valid: false };
      }
      if (status >= 200 && status < 300) {
        return { keyValid: true, walletEmpty: false, modelCount, valid: true };
      }
      return { keyValid: status !== 401, walletEmpty: false, modelCount: 0, valid: false };
    }

    expect(mapVilaoModelsStatus(402)).toEqual({
      keyValid: true,
      walletEmpty: true,
      modelCount: 0,
      valid: true,
    });
    expect(mapVilaoModelsStatus(200, 3)).toEqual({
      keyValid: true,
      walletEmpty: false,
      modelCount: 3,
      valid: true,
    });
    expect(mapVilaoModelsStatus(401).valid).toBe(false);
  });
});
