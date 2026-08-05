import { describe, expect, it, vi, afterEach } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { fetchCavotiModels } from "../../open-sse/services/cavoti.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import {
  CAVOTI_ENDPOINT_PROFILES,
  resolveCavotiEndpoint,
} from "../../open-sse/providers/cavoti.js";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe("Cavoti provider", () => {
  it("registers chat, image, and video models with distinct kinds", () => {
    const entry = REGISTRY.find((provider) => provider.id === "cavoti");
    expect(entry).toBeDefined();
    expect(entry.category).toBe("apikey");
    expect(entry.display.notice.apiKeyUrl).toBe("https://cavoti.com/register?aff=4W6J89CPVV7G");
    expect(entry.serviceKinds).toEqual(["llm", "image", "video"]);
    expect(entry.imageConfig.baseUrl).toBe(CAVOTI_ENDPOINT_PROFILES.images.baseUrl);
    expect(entry.imageConfig.defaultModel).toBe("gpt-image-2");

    const kinds = Object.fromEntries(entry.models.map((model) => [model.id, model.kind]));
    expect(kinds["gpt-5.4"]).toBe("llm");
    expect(kinds["gpt-image-2"]).toBe("image");
    expect(kinds["seedance-2.0"]).toBe("video");
  });

  it("resolves default/global endpoints and keeps images isolated", () => {
    expect(resolveCavotiEndpoint({ path: "models" })).toBe("https://cavoti.com/v1/models");
    expect(resolveCavotiEndpoint({ endpointProfile: "global", path: "models" })).toBe("https://cavoti.up.railway.app/v1/models");
    expect(resolveCavotiEndpoint({ capability: "image" })).toBe("https://api.cavoti.com/v1/images/generations");
    expect(getImageAdapter("cavoti").buildUrl("gpt-image-2", { apiKey: "test-key" }))
      .toBe("https://api.cavoti.com/v1/images/generations");
    expect(getImageAdapter("cavoti").buildBody(undefined, { prompt: "test" }))
      .toMatchObject({ model: "gpt-image-2", prompt: "test" });
  });

  it("merges authenticated models with public pricing and catalog-only video models", async () => {
    global.fetch = vi.fn((url) => {
      if (url === "https://cavoti.up.railway.app/v1/models") {
        return Promise.resolve(new Response(JSON.stringify({ data: [
          { id: "gpt-5.4" },
          { id: "gpt-image-2" },
        ] }), { status: 200 }));
      }
      if (url === "https://cavoti.com/api/v1/public/model-pricing") {
        return Promise.resolve(new Response(JSON.stringify({ data: { platforms: [{ models: [
          { name: "gpt-image-2", group_prices: [{ pricing: { billing_mode: "per_request", per_request_price: 0.02 } }] },
          { name: "seedance-2.0", group_prices: [{ pricing: { billing_mode: "per_second", per_request_price: 0.1 } }] },
        ] }] } }), { status: 200 }));
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await fetchCavotiModels({
      apiKey: "test-key",
      providerSpecificData: { endpointProfile: "global" },
    });

    expect(result.models.find((model) => model.id === "gpt-image-2")).toMatchObject({
      kind: "image",
      availability: "available",
      pricing: { billingMode: "per_request", unit: "USD/request" },
    });
    expect(result.models.find((model) => model.id === "seedance-2.0")).toMatchObject({
      kind: "video",
      availability: "catalog-only",
      pricing: { billingMode: "per_second", unit: "USD/second" },
    });
    expect(global.fetch).toHaveBeenCalledWith("https://cavoti.up.railway.app/v1/models", expect.any(Object));
  });
});
