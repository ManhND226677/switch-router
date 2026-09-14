import { describe, expect, it } from "vitest";
import {
  buildRuntimeCredentials,
  redactProviderConnection,
} from "../../src/core/credentials/credentialProjection.js";

describe("credential projection", () => {
  const connection = {
    id: "connection-1",
    provider: "openai",
    authType: "apikey",
    name: "Personal OpenAI",
    apiKey: "sk-secret",
    accessToken: "access-secret",
    refreshToken: "refresh-secret",
    providerSpecificData: {
      baseUrl: "https://api.example.test",
      nodeName: "home-node",
      copilotToken: "copilot-secret",
      clientSecret: "client-secret",
      sessionToken: "session-secret",
      cookie: "cookie-secret",
    },
  };

  it("keeps the complete credential shape for server-side execution", () => {
    const runtime = buildRuntimeCredentials(connection, {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://127.0.0.1:8080",
      connectionNoProxy: "localhost",
      proxyPoolId: "pool-1",
    });

    expect(runtime).toMatchObject({
      apiKey: "sk-secret",
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      connectionId: "connection-1",
      providerSpecificData: {
        baseUrl: "https://api.example.test",
        copilotToken: "copilot-secret",
        connectionProxyEnabled: true,
        connectionProxyPoolId: "pool-1",
      },
    });
    expect(runtime._connection).toBe(connection);
  });

  it("redacts top-level and provider-specific secrets for API responses", () => {
    const safe = redactProviderConnection(connection);

    expect(safe).toMatchObject({
      id: "connection-1",
      name: "Personal OpenAI",
      providerSpecificData: {
        baseUrl: "https://api.example.test",
        nodeName: "home-node",
      },
    });
    expect(safe).not.toHaveProperty("apiKey");
    expect(safe).not.toHaveProperty("accessToken");
    expect(safe).not.toHaveProperty("refreshToken");
    expect(safe.providerSpecificData).not.toHaveProperty("copilotToken");
    expect(safe.providerSpecificData).not.toHaveProperty("clientSecret");
    expect(safe.providerSpecificData).not.toHaveProperty("sessionToken");
    expect(safe.providerSpecificData).not.toHaveProperty("cookie");
    expect(connection.providerSpecificData.clientSecret).toBe("client-secret");
  });

  it("redacts nested secret keys recursively and new pattern names", () => {
    const nested = redactProviderConnection({
      id: "connection-2",
      provider: "openai",
      name: "Nested",
      apiKey: "top-secret",
      providerSpecificData: {
        baseUrl: "https://api.example.test",
        oauth: {
          accessToken: "nested-token",
          privateKey: "nested-key",
          passphrase: "nested-pass",
          bearer: "nested-bearer",
        },
        mcp: {
          servers: [
            { name: "a", apiKey: "arr-secret", secret: "arr-secret-2" },
            { name: "b" },
          ],
        },
        note: "keep me",
      },
    });

    expect(nested.providerSpecificData).toMatchObject({
      baseUrl: "https://api.example.test",
      note: "keep me",
    });
    expect(nested.providerSpecificData.oauth).toEqual({});
    expect(nested.providerSpecificData.mcp.servers[0]).toEqual({ name: "a" });
    expect(nested.providerSpecificData.mcp.servers[1]).toEqual({ name: "b" });
  });
});
