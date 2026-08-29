import { describe, expect, it, vi } from "vitest";
import { checkFallbackError } from "open-sse/services/accountFallback.js";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "open-sse/config/errorConfig.js";
import fixtures from "../fixtures/upstream-errors/context-overflow.json";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: mocks.updateProviderConnection,
  updateProviderConnectionsBatch: vi.fn(),
  validateApiKey: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
}));

const STEPFUN_BODY = fixtures.overflow[0].body;

describe("checkFallbackError: payloadFault classification", () => {
  it.each(fixtures.overflow)("$name is a payload fault", ({ status, body }) => {
    expect(checkFallbackError(status, body)).toEqual({
      shouldFallback: true,
      cooldownMs: 0,
      payloadFault: true,
    });
  });

  it("keeps an ordinary 400 rotating (no payloadFault)", () => {
    expect(checkFallbackError(400, "messages.1.content.0.text: input should be a string")).toEqual({
      shouldFallback: true,
      cooldownMs: 0,
      payloadFault: false,
    });
  });

  it("keeps the pre-existing `improperly formed request` behaviour untouched", () => {
    const result = checkFallbackError(400, "Request was improperly formed request.");
    expect(result.payloadFault).toBe(false);
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBe(0);
  });

  it("treats a 429 that mentions tokens as a rate limit, not a payload fault", () => {
    const body = '{"error":{"message":"Rate limit exceeded: too many tokens in the last minute"}}';
    const result = checkFallbackError(429, body);
    expect(result.payloadFault).toBe(false);
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
  });

  it("leaves every unrelated error on the transient default", () => {
    expect(checkFallbackError(500, "boom")).toEqual({
      shouldFallback: true,
      cooldownMs: expect.any(Number),
      payloadFault: false,
    });
  });
});

describe("markAccountUnavailable: payload faults never lock or rotate", () => {
  it("returns shouldFallback false and writes nothing to the connection", async () => {
    mocks.getProviderConnections.mockResolvedValue([{ id: "conn-1", backoffLevel: 2 }]);
    const { markAccountUnavailable } = await import("@/sse/services/auth.js");

    const decision = await markAccountUnavailable("conn-1", 400, STEPFUN_BODY, "stepfun", "step-3.7-flash");

    expect(decision).toEqual({ shouldFallback: false, cooldownMs: 0, payloadFault: true });
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("still cools down a rate limit and rotates", async () => {
    mocks.getProviderConnections.mockResolvedValue([{ id: "conn-2", backoffLevel: 0 }]);
    const { markAccountUnavailable } = await import("@/sse/services/auth.js");

    const decision = await markAccountUnavailable("conn-2", 429, "Too many requests", "anthropic", "claude-sonnet-4-6");

    expect(decision.shouldFallback).toBe(true);
    expect(decision.cooldownMs).toBeGreaterThan(0);
    expect(mocks.updateProviderConnection).toHaveBeenCalledTimes(1);
  });

  it("honours a provider-reported reset window over the payload-fault shortcut", async () => {
    mocks.getProviderConnections.mockResolvedValue([{ id: "conn-3", backoffLevel: 0 }]);
    const { markAccountUnavailable } = await import("@/sse/services/auth.js");

    const decision = await markAccountUnavailable(
      "conn-3", 429, "quota exhausted", "openai", "gpt-5.2",
      Date.now() + MAX_RATE_LIMIT_COOLDOWN_MS * 2,
    );

    expect(decision.shouldFallback).toBe(true);
    expect(decision.cooldownMs).toBe(MAX_RATE_LIMIT_COOLDOWN_MS);
  });
});
