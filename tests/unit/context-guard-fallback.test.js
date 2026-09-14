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

  it("classifies the WorkBuddy channel gate (400 code 11128) as a payload fault", () => {
    const body = '{"code":11128,"msg":"Illegal API invocation from an unapproved channel","requestId":"6fbf9e05"}';
    expect(checkFallbackError(400, body)).toEqual({
      shouldFallback: true,
      cooldownMs: 0,
      payloadFault: true,
    });
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

  it("never confuses WorkBuddy's channel gate with a dead account", async () => {
    mocks.getProviderConnections.mockResolvedValue([{ id: "conn-4", backoffLevel: 0 }]);
    mocks.updateProviderConnection.mockClear();
    const { markAccountUnavailable } = await import("@/sse/services/auth.js");

    const gate = await markAccountUnavailable(
      "conn-4", 400, '{"code":11128,"msg":"Illegal API invocation from an unapproved channel"}',
      "workbuddy", "hy4-preview",
    );
    expect(gate).toEqual({ shouldFallback: false, cooldownMs: 0, payloadFault: true });
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();

    // 403 code 11140 is a per-account credential rejection: cooling it down and
    // rotating to a sibling account is exactly what recovers the request.
    const dead = await markAccountUnavailable(
      "conn-4", 403, '{"code":11140,"msg":"request illegal"}', "workbuddy", "hy4-preview",
    );
    expect(dead.shouldFallback).toBe(true);
    expect(dead.cooldownMs).toBeGreaterThan(0);
    expect(mocks.updateProviderConnection).toHaveBeenCalledTimes(1);
  });
});

describe("workbuddy 11140 credential rejection escalates instead of looping", () => {
  const BODY_11140 = '{"code":11140,"msg":"request illegal","requestId":"ebc523e5"}';

  it("first failure starts the backoff ladder (level 1, still rotates)", () => {
    expect(checkFallbackError(403, BODY_11140, 0)).toEqual({
      shouldFallback: true,
      cooldownMs: 2000,
      payloadFault: false,
      newBackoffLevel: 1,
    });
  });

  it("repeated failures escalate the cooldown, capped at BACKOFF max", () => {
    const fourth = checkFallbackError(403, BODY_11140, 3);
    expect(fourth.newBackoffLevel).toBe(4);
    expect(fourth.cooldownMs).toBe(16000);
    expect(fourth.cooldownMs).toBeGreaterThan(checkFallbackError(403, BODY_11140, 0).cooldownMs);
    const capped = checkFallbackError(403, BODY_11140, 15);
    expect(capped.newBackoffLevel).toBe(15);
    expect(capped.cooldownMs).toBe(5 * 60 * 1000);
  });

  it("persists the escalated backoffLevel on the connection", async () => {
    mocks.getProviderConnections.mockResolvedValue([{ id: "conn-5", backoffLevel: 2 }]);
    mocks.updateProviderConnection.mockClear();
    const { markAccountUnavailable } = await import("@/sse/services/auth.js");

    const decision = await markAccountUnavailable("conn-5", 403, BODY_11140, "workbuddy", "hy4-preview");

    expect(decision.shouldFallback).toBe(true);
    expect(decision.cooldownMs).toBe(8000);
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      "conn-5",
      expect.objectContaining({ backoffLevel: 3, testStatus: "unavailable", errorCode: 403 }),
    );
  });

  it("a generic 403 without code 11140 keeps the fixed status cooldown", () => {
    expect(checkFallbackError(403, "Forbidden")).toEqual({
      shouldFallback: true,
      cooldownMs: 2 * 60 * 1000,
      payloadFault: false,
    });
  });
});
