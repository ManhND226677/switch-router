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
  it("openai-compatible: private baseUrl falls back to the default", () => {
    const executor = makeExecutor("openai-compatible-chat-test");
    const url = executor.buildUrl("m", true, 0, {
      providerSpecificData: { baseUrl: "http://127.0.0.1:9999/v1" },
    });
    expect(url).toMatch(/^https:\/\/api\.openai\.com\/v1\/chat\/completions$/);
  });

  it("openai-compatible: public baseUrl is kept", () => {
    const executor = makeExecutor("openai-compatible-chat-test");
    const url = executor.buildUrl("m", true, 0, {
      providerSpecificData: { baseUrl: "https://api.example.com/v1" },
    });
    expect(url).toBe("https://api.example.com/v1/chat/completions");
  });

  it("anthropic-compatible: private baseUrl falls back to the default", () => {
    const executor = makeExecutor("anthropic-compatible-test");
    const url = executor.buildUrl("m", true, 0, {
      providerSpecificData: { baseUrl: "http://10.1.2.3" },
    });
    expect(url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages$/);
  });
});