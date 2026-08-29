// Model-level backpressure registry (open-sse/services/modelThrottle.js).
// Drives the "HOT model" state that combo rotation uses to stop feeding
// provider/model targets that keep returning 429.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  recordModelRateLimit,
  getModelThrottle,
  clearModelThrottle,
  partitionThrottledModels,
  _setClock,
  _resetModelThrottleForTests,
} from "../../open-sse/services/modelThrottle.js";

const WINDOW_MS = 5 * 60 * 1000;

describe("modelThrottle registry", () => {
  let now;
  beforeEach(() => {
    now = 1_000_000_000_000;
    _setClock(() => now);
    _resetModelThrottleForTests();
  });
  afterEach(() => {
    _setClock(null);
    _resetModelThrottleForTests();
  });

  it("does not throttle below the threshold (2 hits)", () => {
    recordModelRateLimit("p", "m");
    recordModelRateLimit("p", "m");
    expect(getModelThrottle("p", "m").throttled).toBe(false);
  });

  it("throttles at the 3rd hit within the window with a 60s cooldown", () => {
    recordModelRateLimit("p", "m");
    recordModelRateLimit("p", "m");
    const t = recordModelRateLimit("p", "m");
    expect(t.throttled).toBe(true);
    expect(t.hotLevel).toBe(1);
    expect(t.remainingMs).toBe(60_000);
  });

  it("hits older than the sliding window do not count", () => {
    recordModelRateLimit("p", "m");
    recordModelRateLimit("p", "m");
    now += WINDOW_MS + 1000; // both hits age out
    recordModelRateLimit("p", "m");
    expect(getModelThrottle("p", "m").throttled).toBe(false);
  });

  it("honors a provider Retry-After as the throttle floor", () => {
    recordModelRateLimit("p", "m");
    recordModelRateLimit("p", "m");
    const t = recordModelRateLimit("p", "m", { retryAfterMs: 10 * 60 * 1000 });
    expect(t.throttled).toBe(true);
    expect(t.remainingMs).toBe(10 * 60 * 1000);
  });

  it("escalates the cooldown when the model goes hot again after expiry", () => {
    for (let i = 0; i < 3; i++) recordModelRateLimit("p", "m"); // level 1: 60s
    now += 61_000; // throttle lapses
    recordModelRateLimit("p", "m");
    recordModelRateLimit("p", "m");
    const t = recordModelRateLimit("p", "m"); // level 2: 4 min
    expect(t.hotLevel).toBe(2);
    expect(t.remainingMs).toBe(4 * 60 * 1000);
  });

  it("while throttled, further 429s only extend via Retry-After", () => {
    for (let i = 0; i < 3; i++) recordModelRateLimit("p", "m");
    const before = getModelThrottle("p", "m").untilMs;
    expect(before).toBe(now + 60_000);
    recordModelRateLimit("p", "m"); // no retryAfter → no change
    expect(getModelThrottle("p", "m").untilMs).toBe(before);
    recordModelRateLimit("p", "m", { retryAfterMs: 30 * 60 * 1000 });
    expect(getModelThrottle("p", "m").untilMs).toBe(now + 30 * 60 * 1000);
  });

  it("clearModelThrottle releases the model immediately", () => {
    for (let i = 0; i < 3; i++) recordModelRateLimit("p", "m");
    expect(getModelThrottle("p", "m").throttled).toBe(true);
    clearModelThrottle("p", "m");
    expect(getModelThrottle("p", "m").throttled).toBe(false);
    expect(getModelThrottle("p", "m").hotLevel).toBe(0);
  });

  it("keeps distinct models independent", () => {
    for (let i = 0; i < 3; i++) recordModelRateLimit("p", "hot");
    recordModelRateLimit("p", "cool", {});
    expect(getModelThrottle("p", "hot").throttled).toBe(true);
    expect(getModelThrottle("p", "cool").throttled).toBe(false);
  });

  it("throttle lapses on its own after the cooldown", () => {
    for (let i = 0; i < 3; i++) recordModelRateLimit("p", "m");
    now += 61_000;
    expect(getModelThrottle("p", "m").throttled).toBe(false);
  });
});

describe("partitionThrottledModels", () => {
  beforeEach(() => {
    _setClock(() => 1_000_000_000_000);
    _resetModelThrottleForTests();
  });
  afterEach(() => {
    _setClock(null);
    _resetModelThrottleForTests();
  });

  it("splits hot models out, preserving order in both groups", () => {
    for (let i = 0; i < 3; i++) {
      recordModelRateLimit("p", "hot1");
      recordModelRateLimit("p", "hot2");
    }
    const { ready, throttled } = partitionThrottledModels([
      "p/hot1", "p/a", "p/hot2", "p/b",
    ]);
    expect(ready).toEqual(["p/a", "p/b"]);
    expect(throttled.map((t) => t.model)).toEqual(["p/hot1", "p/hot2"]);
    expect(throttled.every((t) => t.untilMs > 0)).toBe(true);
  });

  it("passes through entries without provider/model prefix as ready", () => {
    const { ready, throttled } = partitionThrottledModels(["plainname", "p/ok"]);
    expect(ready).toEqual(["plainname", "p/ok"]);
    expect(throttled).toEqual([]);
  });
});
