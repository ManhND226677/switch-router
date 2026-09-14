import { describe, expect, it, vi } from "vitest";
import { getExecutor } from "../../open-sse/executors/index.js";
import {
  ProviderAdapter,
  clearProviderAdapterCache,
  createProviderAdapter,
  getProviderAdapter,
} from "../../src/core/providers/providerAdapter.js";

describe("ProviderAdapter", () => {
  it("delegates provider execution and credential operations", async () => {
    const result = { response: { status: 200 }, url: "https://provider.test" };
    const executor = {
      noAuth: true,
      execute: vi.fn().mockResolvedValue(result),
      refreshCredentials: vi.fn().mockResolvedValue({ accessToken: "refreshed" }),
      needsRefresh: vi.fn().mockReturnValue(true),
      parseError: vi.fn().mockReturnValue({ status: 429, message: "slow down" }),
    };
    const adapter = new ProviderAdapter("test-provider", executor);
    const options = { model: "test-model", body: {}, stream: false };

    await expect(adapter.execute(options)).resolves.toBe(result);
    await expect(adapter.refreshCredentials({ accessToken: "old" }, "log")).resolves.toEqual({ accessToken: "refreshed" });
    expect(adapter.needsRefresh({ accessToken: "old" })).toBe(true);
    expect(adapter.parseError({ status: 429 }, "quota")).toEqual({ status: 429, message: "slow down" });
    expect(adapter.noAuth).toBe(true);
    expect(executor.execute).toHaveBeenCalledWith(options);
    expect(executor.refreshCredentials).toHaveBeenCalledWith({ accessToken: "old" }, "log", null);
  });

  it("provides safe defaults for minimal provider implementations", async () => {
    const adapter = createProviderAdapter("minimal", {
      execute: vi.fn().mockResolvedValue({ response: { status: 200 } }),
    });

    expect(adapter.noAuth).toBe(false);
    await expect(adapter.refreshCredentials({}, null)).resolves.toBeNull();
    expect(adapter.needsRefresh({})).toBe(false);
    expect(adapter.parseError({ status: 502 }, "upstream failed")).toEqual({
      status: 502,
      message: "upstream failed",
    });
  });

  it("caches one facade for each existing executor", () => {
    clearProviderAdapterCache();

    const first = getProviderAdapter("openai");
    const second = getProviderAdapter("openai");

    expect(first).toBe(second);
    expect(first.provider).toBe("openai");
    expect(first.executor).toBe(getExecutor("openai"));
  });

  it("rejects an incomplete adapter boundary", () => {
    expect(() => new ProviderAdapter("", {})).toThrow("requires a provider id");
    expect(() => new ProviderAdapter("test-provider", {})).toThrow("requires an executor");
  });
});
