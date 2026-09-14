import { describe, expect, it, vi, beforeEach } from "vitest";

// proxyAwareFetch snapshots globalThis.fetch at module load, so the usage tests
// mock the module itself (same pattern as vilao-usage.test.js).
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_OAUTH, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { OAUTH_PROVIDERS, USAGE_SUPPORTED_PROVIDERS, USAGE_APIKEY_PROVIDERS } from "../../src/shared/constants/providers.js";
import { getProvider } from "../../src/lib/oauth/providers.js";
import { UNSTOPPABLE_CONFIG } from "../../src/lib/oauth/constants/oauth.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUnstoppableUsage } from "../../open-sse/services/usage/unstoppable.js";

describe("Unstoppable Code provider registration", () => {
  it("registers as an OAuth Anthropic-format provider", () => {
    const provider = REGISTRY.find((entry) => entry.id === "unstoppable");
    expect(provider).toMatchObject({
      id: "unstoppable",
      alias: "udc",
      category: "oauth",
      passthroughModels: true,
    });
    // The LLM proxy speaks the Anthropic Messages API, so the transport must
    // target the anthropic route and use the claude format — not openai.
    expect(PROVIDERS.unstoppable).toMatchObject({
      baseUrl: "https://app.unstoppable.ai/api/v1/llm-proxy/anthropic/v1/messages",
      format: "claude",
    });
    // tokenUrl is injected from the oauth block (single source).
    expect(PROVIDERS.unstoppable.tokenUrl).toBe(UNSTOPPABLE_CONFIG.tokenUrl);
    expect(PROVIDER_OAUTH.unstoppable).toMatchObject({
      authorizeUrl: "https://app.unstoppable.ai/desktop-auth",
      tokenUrl: "https://app.unstoppable.ai/api/v1/desktop-app/desktop-auth/token",
      codeChallengeMethod: "S256",
    });
  });

  it("forces streaming because the proxy rejects non-stream requests", () => {
    // POSTing without stream:true answers
    // {"error":"LLM proxy requests must set stream: true."} — verified live.
    expect(PROVIDERS.unstoppable.forceStream).toBe(true);
  });

  it("is surfaced as an OAuth provider in the UI category map", () => {
    expect(OAUTH_PROVIDERS.unstoppable).toBeTruthy();
  });

  it("declares both oauth and apikey entry paths", () => {
    // The desktop app itself accepts a pasted API key OR an OAuth login for the
    // same cskToken; declaring both lets a Pro user skip the OAuth dance.
    const provider = REGISTRY.find((entry) => entry.id === "unstoppable");
    expect(provider.authModes).toEqual(["oauth", "apikey"]);
    expect(provider.hasOAuth).toBe(true);
  });

  it("ships the ai-gateway catalog with gatewayId routing per model", () => {
    const models = PROVIDER_MODELS.udc;
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBe(25);
    // The proxy routes on `gatewayId` (<family>/<model>), while the catalog id is
    // the short form users type after `udc/` — so every entry needs a mapping.
    for (const model of models) {
      expect(typeof model.id).toBe("string");
      expect(model.upstreamModelId).toBeTruthy();
      expect(model.upstreamModelId).toMatch(/^[a-z0-9-]+\/[^\s/][^\s]*$/);
    }
    const byId = Object.fromEntries(models.map((m) => [m.id, m.upstreamModelId]));
    expect(byId["claude-sonnet-5"]).toBe("anthropic/claude-sonnet-5");
    expect(byId["claude-haiku-4.5"]).toBe("anthropic/claude-haiku-4.5");
    expect(byId["gpt-5.6-luna"]).toBe("openai/gpt-5.6-luna");
    expect(byId["deepseek-v4.1-flash"]).toBe("deepseek/deepseek-v4.1-flash");
    expect(byId["glm-5.3"]).toBe("zai/glm-5.3");
    expect(byId["minimax-m3"]).toBe("minimax/minimax-m3");
    expect(byId["kimi-k3"]).toBe("moonshotai/kimi-k3");
  });

  it("exposes the AI Credits usage endpoints on the transport", () => {
    expect(PROVIDERS.unstoppable.usage).toMatchObject({
      url: "https://app.unstoppable.ai/api/v1/ai-credits/balance",
      subscriptionUrl: "https://app.unstoppable.ai/api/v1/ai-credits/subscription",
    });
  });
});

describe("Unstoppable Code OAuth flow", () => {
  it("resolves as an authorization_code_pkce provider", () => {
    const handler = getProvider("unstoppable");
    expect(handler.flowType).toBe("authorization_code_pkce");
    expect(handler.config).toBe(UNSTOPPABLE_CONFIG);
  });

  it("builds a desktop-auth authorize URL with the Unstoppable client params", async () => {
    const handler = getProvider("unstoppable");
    const config = await handler.prepareConfig(handler.config, {});
    // The desktop-auth flow sends client identity fields instead of client_id.
    expect(config.clientDeviceId).toBeTruthy();
    expect(config.clientVersion).toBeTruthy();
    expect(config.clientHostname).toBeTruthy();

    const url = handler.buildAuthUrl(
      config,
      "http://localhost:8080/callback",
      "state-abc",
      "challenge-xyz",
    );
    expect(url.startsWith("https://app.unstoppable.ai/desktop-auth?")).toBe(true);
    const { searchParams } = new URL(url);
    expect(searchParams.get("state")).toBe("state-abc");
    expect(searchParams.get("code_challenge")).toBe("challenge-xyz");
    expect(searchParams.get("code_challenge_method")).toBe("S256");
    expect(searchParams.get("redirect_uri")).toBe("http://localhost:8080/callback");
    expect(searchParams.get("client_name")).toBe(config.clientName);
    expect(searchParams.get("client_device_id")).toBe(config.clientDeviceId);
    expect(searchParams.get("client_version")).toBe(config.clientVersion);
    expect(searchParams.get("client_hostname")).toBe(config.clientHostname);
  });

  it("exchanges the code with a camelCase JSON body", async () => {
    const handler = getProvider("unstoppable");
    const config = await handler.prepareConfig(handler.config, {});
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({
          // Real desktop-auth/token shape: camelCase, credential in `token`.
          token: "csk-token",
          userApiKey: { id: "key-id", source: "GUEST" },
          account: { id: "acct", email: "user@example.com" },
        }),
      };
    };
    try {
      const tokens = await handler.exchangeToken(
        config,
        "auth-code",
        "http://localhost:8080/callback",
        "verifier-123",
        "state-abc",
        {},
      );
      const call = calls[0];
      expect(call.url).toBe(config.tokenUrl);
      expect(call.init.method).toBe("POST");
      expect(call.init.headers["Content-Type"]).toBe("application/json");
      // camelCase field names, not snake_case oauth2 — this is what the
      // Unstoppable desktop-auth/token endpoint expects.
      const body = JSON.parse(call.init.body);
      expect(body).toMatchObject({
        grantType: "authorization_code",
        code: "auth-code",
        codeVerifier: "verifier-123",
        redirectUri: "http://localhost:8080/callback",
        clientName: config.clientName,
        clientDeviceId: config.clientDeviceId,
      });
      // mapTokens (applied by exchangeTokens, one layer up) normalizes the
      // raw upstream response into the connection shape. Reading access_token
      // here instead of `token` saved a connection with no credential, which
      // surfaced as "401 Invalid API key" right after a successful login.
      const mapped = handler.mapTokens(tokens);
      expect(mapped).toEqual({ accessToken: "csk-token", email: "user@example.com" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Unstoppable Code usage (AI Credits)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const jsonResponse = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  it("is registered for the Quota Tracker under both auth modes", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("unstoppable");
    expect(USAGE_APIKEY_PROVIDERS).toContain("unstoppable");
  });

  it("maps balance + subscription into a credits quota row", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({
        email: "pro@example.com",
        credits: 120,
        dailyDripCapCredits: 200,
        eligible: true,
        source: "canopy",
        orgPool: null,
      }))
      .mockResolvedValueOnce(jsonResponse({
        active: false,
        plan: "Pro",
        renewsAt: "2026-10-14T00:00:00.000Z",
      }));

    const usage = await getUnstoppableUsage({ accessToken: "csk-test" });
    // credits is the REMAINING balance; dailyDripCapCredits is the denominator.
    expect(usage.native).toMatchObject({
      status: "ok",
      remainingCredits: 120,
      totalCredits: 200,
      usedCredits: 80,
      remainingPercentage: 60,
      plan: "Pro",
      subscriptionActive: false,
    });
    expect(usage.quotas.credits).toMatchObject({
      used: 80,
      total: 200,
      remaining: 120,
      percentageAvailable: true,
      unit: "credits",
    });
    expect(usage.message).toBeNull();
  });

  it("drops the daily-cap bar when a paid subscription is active", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ credits: 500, dailyDripCapCredits: 25, source: "canopy" }))
      .mockResolvedValueOnce(jsonResponse({ active: true, plan: "Pro" }));

    const usage = await getUnstoppableUsage({ accessToken: "csk-test" });
    // A paid seat is not drip-limited: showing "500 / 25" would be nonsense.
    expect(usage.native.totalCredits).toBeNull();
    expect(usage.native.remainingCredits).toBe(500);
    expect(usage.quotas.credits.percentageAvailable).toBe(false);
  });

  it("reports an auth failure instead of a bogus zero balance", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ error: "Invalid API key" }, 401))
      .mockResolvedValueOnce(jsonResponse({}, 401));

    const usage = await getUnstoppableUsage({ accessToken: "bad" });
    expect(usage.message).toMatch(/sign in again/i);
    expect(usage.quotas.credits.used).toBeNull();
    expect(usage.native.status).toBe("http_401");
  });

  it("returns a message when no credential is present", async () => {
    const usage = await getUnstoppableUsage({});
    expect(usage.message).toMatch(/not available/i);
    expect(usage.native.status).toBe("unavailable");
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });
});
