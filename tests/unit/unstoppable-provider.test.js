import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_OAUTH, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { OAUTH_PROVIDERS } from "../../src/shared/constants/providers.js";
import { getProvider } from "../../src/lib/oauth/providers.js";
import { UNSTOPPABLE_CONFIG } from "../../src/lib/oauth/constants/oauth.js";

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

  it("is surfaced as an OAuth provider in the UI category map", () => {
    expect(OAUTH_PROVIDERS.unstoppable).toBeTruthy();
  });

  it("publishes a fallback model list under the udc alias", () => {
    const models = PROVIDER_MODELS.udc;
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    // Passthrough is on, so this list is only a picker fallback — but it must
    // still exist so a fresh install has something to select before the
    // dynamic catalog is fetched.
    for (const model of models) {
      expect(typeof model.id).toBe("string");
      expect(model.id.length).toBeGreaterThan(0);
    }
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
          access_token: "csk-token",
          refresh_token: "rtoken",
          expires_in: 3600,
          scope: "openid",
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
      // raw upstream response into the connection shape.
      const mapped = handler.mapTokens(tokens);
      expect(mapped).toEqual({
        accessToken: "csk-token",
        refreshToken: "rtoken",
        expiresIn: 3600,
        scope: "openid",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
