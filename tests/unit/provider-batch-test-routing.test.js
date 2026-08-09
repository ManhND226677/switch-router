import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  testSingleConnection: vi.fn(),
}));

vi.mock("@/models", () => ({
  getProviderConnections: mocks.getProviderConnections,
}));

vi.mock("@/app/api/providers/[id]/test/testUtils.js", () => ({
  testSingleConnection: mocks.testSingleConnection,
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

function makeRequest(mode) {
  return new Request("https://9router.local/api/providers/test-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
}

describe("provider batch test routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.testSingleConnection.mockImplementation(async (id) => ({
      valid: true,
      latencyMs: 1,
      testedAt: "2026-01-01T00:00:00.000Z",
      id,
    }));
  });

  it("tests only LLM API-key connections in the API Key batch", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "ollama-key", provider: "ollama", authType: "apikey", name: "Ollama", isActive: true },
      { id: "gemini-key", provider: "gemini", authType: "apikey", name: "Gemini", isActive: true },
      { id: "elevenlabs-key", provider: "elevenlabs", authType: "apikey", name: "ElevenLabs", isActive: true },
      { id: "exa-key", provider: "exa", authType: "apikey", name: "Exa", isActive: true },
    ]);

    const { POST } = await import("@/app/api/providers/test-batch/route.js");
    const response = await POST(makeRequest("apikey"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary).toEqual({ total: 2, passed: 2, failed: 0 });
    expect(body.results.map((result) => result.provider)).toEqual(["ollama", "gemini"]);
    expect(mocks.testSingleConnection).toHaveBeenCalledTimes(2);
    expect(mocks.testSingleConnection).toHaveBeenCalledWith("ollama-key");
    expect(mocks.testSingleConnection).toHaveBeenCalledWith("gemini-key");
  });
});
