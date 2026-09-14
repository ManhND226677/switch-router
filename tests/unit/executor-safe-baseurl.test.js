/**
 * SSRF guard regression tests: user-supplied base URLs (openai-compatible /
 * anthropic-compatible providers) must never point at private/loopback hosts.
 */

import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { validateSafeBaseUrl } from "../../open-sse/utils/safeBaseUrl.js";

function makeExecutor(provider) {
  const executor = new DefaultExecutor(provider);
  executor.provider = provider;
  return executor;
}

describe("validateSafeBaseUrl", () => {
  it("accepts public https hosts", () => {
    expect(validateSafeBaseUrl("https://api.example.com/v1").ok).toBe(true);
  });

  it("rejects loopback/private/link-local literals", () => {
    for (const bad of [
      "http://127.0.0.1:8080",
      "https://169.254.169.254/latest/meta-data",
      "http://10.0.0.5",
      "http://192.168.1.1",
      "http://172.16.5.4",
      "http://[::1]:8000",
      "http://[fe80::1]",
      "http://localhost:11434",
      "http://myhost.local",
      "ftp://example.com",
    ]) {
      expect(validateSafeBaseUrl(bad).ok, bad).toBe(false);
    }
  });
});

describe("DefaultExecutor.buildUrl SSRF guard", () => {
  it("openai-compatible: private baseUrl is rejected loudly, never rerouted to the vendor default", () => {
    const executor = makeExecutor("openai-compatible-chat-test");
    let caught = null;
    try {
      executor.buildUrl("m", true, 0, {
        providerSpecificData: { baseUrl: "http://127.0.0.1:9999/v1" },
        apiKey: "sk-secret-material",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toContain("127.0.0.1:9999");
    // The whole point: no api.openai.com request carrying the stored key.
    expect(caught.message).not.toContain("api.openai.com");
    expect(caught.message).not.toContain("sk-secret-material");
  });

  it("openai-compatible: public baseUrl is kept", () => {
    const executor = makeExecutor("openai-compatible-chat-test");
    const url = executor.buildUrl("m", true, 0, {
      providerSpecificData: { baseUrl: "https://api.example.com/v1" },
    });
    expect(url).toBe("https://api.example.com/v1/chat/completions");
  });

  it("anthropic-compatible: private baseUrl is rejected, never rerouted to api.anthropic.com", () => {
    const executor = makeExecutor("anthropic-compatible-test");
    expect(() => executor.buildUrl("m", true, 0, {
      providerSpecificData: { baseUrl: "http://10.1.2.3" },
      apiKey: "sk-ant-secret-material",
    })).toThrow(/10\.1\.2\.3/);
  });
});