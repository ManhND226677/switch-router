import { describe, expect, it, vi } from "vitest";
import { RoutingEngine } from "../../src/core/routing/routingEngine.js";

describe("account fallback engine", () => {
  it("returns the first successful attempt", async () => {
    const resolveCredentials = vi.fn().mockResolvedValue({ connectionId: "primary" });
    const executeAttempt = vi.fn().mockResolvedValue({ success: true, response: "ok" });
    const onFailure = vi.fn();
    const engine = new RoutingEngine({ resolveCredentials, executeAttempt, onFailure });

    const result = await engine.execute({ provider: "openai", model: "gpt-4.1" });

    // Success results carry the attempt count for observability (routing metrics).
    expect(result).toEqual({ success: true, response: "ok", attempts: 1 });
    expect(resolveCredentials).toHaveBeenCalledTimes(1);
    expect(executeAttempt).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("excludes a failed connection when the failure policy allows fallback", async () => {
    const resolveCredentials = vi.fn()
      .mockResolvedValueOnce({ connectionId: "primary" })
      .mockResolvedValueOnce({ connectionId: "backup" });
    const executeAttempt = vi.fn()
      .mockResolvedValueOnce({ success: false, status: 503, error: "primary down" })
      .mockResolvedValueOnce({ success: true, response: "backup response" });
    const onFailure = vi.fn().mockResolvedValue({ shouldFallback: true });
    const engine = new RoutingEngine({ resolveCredentials, executeAttempt, onFailure });

    const result = await engine.execute({ provider: "openai", model: "gpt-4.1" });

    expect(result).toEqual({ success: true, response: "backup response", attempts: 2 });
    expect(resolveCredentials).toHaveBeenNthCalledWith(2, expect.objectContaining({
      excludedConnectionIds: new Set(["primary"]),
    }));
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it("returns the terminal failure when fallback is denied", async () => {
    const resolveCredentials = vi.fn().mockResolvedValue({ connectionId: "primary" });
    const executeAttempt = vi.fn().mockResolvedValue({ success: false, status: 400, error: "invalid request" });
    const onFailure = vi.fn().mockResolvedValue({ shouldFallback: false });
    const engine = new RoutingEngine({ resolveCredentials, executeAttempt, onFailure });

    const result = await engine.execute({ provider: "openai", model: "gpt-4.1" });

    expect(result).toEqual({ success: false, status: 400, error: "invalid request" });
    expect(resolveCredentials).toHaveBeenCalledTimes(1);
    expect(executeAttempt).toHaveBeenCalledTimes(1);
  });

  it("preserves the last failure when all candidates are unavailable", async () => {
    const resolveCredentials = vi.fn()
      .mockResolvedValueOnce({ connectionId: "primary" })
      .mockResolvedValueOnce(null);
    const executeAttempt = vi.fn().mockResolvedValue({ success: false, status: 503, error: "primary down" });
    const onFailure = vi.fn().mockResolvedValue({ shouldFallback: true });
    const engine = new RoutingEngine({ resolveCredentials, executeAttempt, onFailure });

    const result = await engine.execute({ provider: "openai", model: "gpt-4.1" });

    expect(result.outcome).toBe("unavailable");
    expect(result.lastResult).toEqual({ success: false, status: 503, error: "primary down" });
    expect(result.excludedConnectionIds).toEqual(new Set(["primary"]));
  });
});
