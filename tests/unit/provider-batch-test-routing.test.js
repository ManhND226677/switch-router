import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  testSingleConnection: vi.fn(),
}));

vi.mock("../../src/lib/localDb.js", () => ({
  getProviderConnections: mocks.getProviderConnections,
}));

vi.mock("../../src/shared/constants/providers.js", () => ({
  AI_PROVIDERS: {
    ollama: { serviceKinds: ["llm"] },
    gemini: { serviceKinds: ["llm"] },
    "media-tts": { serviceKinds: ["tts"] },
    "media-search": { serviceKinds: ["search"] },
  },
  FREE_PROVIDERS: {},
  OAUTH_PROVIDERS: {},
  APIKEY_PROVIDERS: { ollama: true, gemini: true, "media-tts": true, "media-search": true },
  OPENAI_COMPATIBLE_PREFIX: "custom-",
  ANTHROPIC_COMPATIBLE_PREFIX: "anthropic-",
}));

vi.mock("../../src/app/api/providers/[id]/test/testUtils.js", () => ({
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
      { id: "tts-key", provider: "media-tts", authType: "apikey", name: "Media TTS", isActive: true },
      { id: "search-key", provider: "media-search", authType: "apikey", name: "Media Search", isActive: true },
    ]);

    const { POST } = await import("../../src/app/api/providers/test-batch/route.js");
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
