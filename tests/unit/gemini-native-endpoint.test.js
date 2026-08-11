import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleChat: vi.fn(),
  getSettings: vi.fn(),
  isValidApiKey: vi.fn(),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
}));

vi.mock("@/sse/handlers/chat.js", () => ({
  handleChat: mocks.handleChat,
}));

vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  isValidApiKey: mocks.isValidApiKey,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
}));

const { GET } = await import("../../src/app/api/v1beta/models/route.js");
const { POST } = await import("../../src/app/api/v1beta/models/[...path]/route.js");

function makeGeminiRequest(path, body, headers = {}) {
  return new Request(`https://router.test/v1beta/models/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer router-client-key",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("Gemini native v1beta endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: true });
    mocks.isValidApiKey.mockResolvedValue(true);
    mocks.getProviderCredentials.mockResolvedValue({
      apiKey: "real-gemini-key",
      connectionId: "gemini-conn",
      connectionName: "Gemini Test",
      providerSpecificData: {},
    });
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false });
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    mocks.handleChat.mockResolvedValue(
      Response.json({ candidates: [{ content: { parts: [{ text: "chat" }] } }] })
    );
  });

  it("lists Gemini models with bare and prefixed names", async () => {
    const response = await GET();
    const body = await response.json();
    const names = body.models.map((model) => model.name);

    expect(names).toContain("models/gemini-3.1-pro-preview");
    expect(names).toContain("models/gemini/gemini-3.1-pro-preview");
  });

  it("keeps Gemini requests on the existing chat conversion path", async () => {
    const body = {
      contents: [{ parts: [{ text: "hello" }] }],
      generationConfig: { temperature: 0.3 },
    };

    await POST(makeGeminiRequest("gemini-2.5-flash:generateContent", body), {
      params: Promise.resolve({ path: ["gemini-2.5-flash:generateContent"] }),
    });

    expect(mocks.handleChat).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not hijack provider-prefixed requests", async () => {
    await POST(makeGeminiRequest("openai/gpt-4o-mini:generateContent", {
      contents: [{ parts: [{ text: "hello" }] }],
    }), {
      params: Promise.resolve({ path: ["openai", "gpt-4o-mini:generateContent"] }),
    });

    expect(mocks.handleChat).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
