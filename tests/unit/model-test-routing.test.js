import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiKeys: vi.fn(),
  getProviderConnections: vi.fn(),
  getConsistentMachineId: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeys: mocks.getApiKeys,
  getProviderConnections: mocks.getProviderConnections,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

const originalFetch = global.fetch;

describe("model test route kind routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApiKeys.mockResolvedValue([{ key: "sk-internal", isActive: true }]);
    mocks.getProviderConnections.mockResolvedValue([]);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      created: 1,
      data: [{ b64_json: "abc" }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("routes image model tests to /api/v1/images/generations", async () => {
    const { POST } = await import("../../src/app/api/models/test/route.js");

    const req = new Request("http://localhost/api/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "hf/black-forest-labs/FLUX.1-schnell",
        kind: "image",
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/images/generations"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "hf/black-forest-labs/FLUX.1-schnell",
          prompt: "test",
        }),
      })
    );
  });

  it("routes embedding model tests to /api/v1/embeddings", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ embedding: [0.1, 0.2] }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const { POST } = await import("../../src/app/api/models/test/route.js");

    const req = new Request("http://localhost/api/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "voyage/voyage-3-large",
        kind: "embedding",
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/embeddings"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "voyage/voyage-3-large",
          input: "test",
        }),
      })
    );
  });

  it("fails embedding model tests when provider returns no embedding data", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ embedding: null }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const { POST } = await import("../../src/app/api/models/test/route.js");

    const req = new Request("http://localhost/api/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "voyage/voyage-3-large",
        kind: "embedding",
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.error).toBe("Provider returned no embedding data");
  });

  it("routes stt model tests to /api/v1/audio/transcriptions", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      text: "test",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const { POST } = await import("../../src/app/api/models/test/route.js");

    const req = new Request("http://localhost/api/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "hf/openai/whisper-small",
        kind: "stt",
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/audio/transcriptions"),
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData),
      })
    );
  });

  it("returns formatted HTTP errors for non-2xx embedding responses", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: "bad upstream" },
    }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    }));

    const { POST } = await import("../../src/app/api/models/test/route.js");

    const req = new Request("http://localhost/api/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "voyage/voyage-3-large",
        kind: "embedding",
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.status).toBe(502);
    expect(body.error).toBe("HTTP 502: bad upstream");
  });

  it("checks Cavoti model availability through /models without sending a chat request", async () => {
    mocks.getProviderConnections.mockResolvedValue([{
      provider: "cavoti",
      apiKey: "test-key",
      isActive: true,
      providerSpecificData: { endpointProfile: "global" },
    }]);
    global.fetch = vi.fn((url) => {
      if (url === "https://cavoti.up.railway.app/v1/models") {
        return Promise.resolve(new Response(JSON.stringify({ data: [{ id: "gpt-5.6-luna" }] }), { status: 200 }));
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const { POST } = await import("../../src/app/api/models/test/route.js");
    const req = new Request("http://localhost/api/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "cavoti/gpt-5.6-luna" }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://cavoti.up.railway.app/v1/models",
      expect.objectContaining({ method: "GET" }),
    );
    expect(global.fetch.mock.calls.some(([url]) => String(url).includes("/chat/completions"))).toBe(false);
  });
});
