import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiKeys: vi.fn(),
  getProviderConnections: vi.fn(),
  getConsistentMachineId: vi.fn(),
}));

vi.mock("../../src/lib/localDb.js", () => ({
  getApiKeys: mocks.getApiKeys,
  getProviderConnections: mocks.getProviderConnections,
}));

vi.mock("../../src/shared/utils/machineId.js", () => ({
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
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "hi" } }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("routes llm model tests to /api/v1/chat/completions", async () => {
    const { POST } = await import("../../src/app/api/models/test/route.js");

    const req = new Request("http://localhost/api/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-5",
        kind: "llm",
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/chat/completions"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "openai/gpt-5",
          max_tokens: 16,
          stream: false,
          messages: [{ role: "user", content: "hi" }],
        }),
      })
    );
  });

  it("routes every model kind through /api/v1/chat/completions", async () => {
    const { POST } = await import("../../src/app/api/models/test/route.js");

    for (const kind of ["llm", "imageToText"]) {
      const req = new Request("http://localhost/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "openai/gpt-5", kind }),
      });

      const res = await POST(req);
      expect((await res.json()).ok).toBe(true);
      expect(global.fetch).toHaveBeenLastCalledWith(
        expect.stringContaining("/api/v1/chat/completions"),
        expect.any(Object)
      );
    }
  });

  it("returns formatted HTTP errors for non-2xx responses", async () => {
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
      body: JSON.stringify({ model: "openai/gpt-5", kind: "llm" }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.status).toBe(502);
    expect(body.error).toBe("HTTP 502: bad upstream");
  });

  it("fails when provider returns no completion choices", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const { POST } = await import("../../src/app/api/models/test/route.js");

    const req = new Request("http://localhost/api/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/gpt-5", kind: "llm" }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.error).toBe("Provider returned no completion choices for this model");
  });
});
