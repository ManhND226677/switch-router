// Combo backpressure: HOT models (repeated 429s recorded in modelThrottle)
// are pulled out of combo rotation instead of being fed more requests.
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { handleComboChat } from "../../open-sse/services/combo.js";
import {
  recordModelRateLimit,
  _resetModelThrottleForTests,
} from "../../open-sse/services/modelThrottle.js";

const log = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };
const body = { model: "combo-x", messages: [{ role: "user", content: "hi" }] };

const okResponse = () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
const failResponse = (status, message) =>
  new Response(JSON.stringify({ error: { message } }), { status });

function makeHot(provider, model) {
  for (let i = 0; i < 3; i++) recordModelRateLimit(provider, model, { reason: "429 too many requests" });
}

describe("combo backpressure for throttled models", () => {
  beforeEach(() => _resetModelThrottleForTests());
  afterEach(() => _resetModelThrottleForTests());

  it("skips a HOT model and serves the ready one without calling the hot one", async () => {
    makeHot("p", "hot");
    const calls = [];
    const res = await handleComboChat({
      body,
      models: ["p/hot", "p/cool"],
      handleSingleModel: async (b, m) => { calls.push(m); return okResponse(); },
      log,
      comboName: "combo-x",
      comboStrategy: "fallback",
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["p/cool"]);
  });

  it("returns 429 with Retry-After when every combo model is throttled", async () => {
    makeHot("p", "hot1");
    makeHot("p", "hot2");
    const calls = [];
    const res = await handleComboChat({
      body,
      models: ["p/hot1", "p/hot2"],
      handleSingleModel: async (b, m) => { calls.push(m); return okResponse(); },
      log,
      comboName: "combo-x",
      comboStrategy: "fallback",
    });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    const json = await res.json();
    expect(json.error.message).toContain("rate-limited");
    expect(calls).toEqual([]); // no attempt burned on hot models
  });

  it("after ready models fail, reports the throttle reset instead of burning hot models", async () => {
    makeHot("p", "hot");
    const calls = [];
    const res = await handleComboChat({
      body,
      models: ["p/fragile", "p/hot"],
      handleSingleModel: async (b, m) => { calls.push(m); return failResponse(500, "boom"); },
      log,
      comboName: "combo-x",
      comboStrategy: "fallback",
    });
    expect(calls).toEqual(["p/fragile"]); // hot model never attempted
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error.message).toContain("rate-limited");
    expect(json.error.message).toContain("boom"); // last ready error surfaced
  });

  it("keeps normal fallback behavior when nothing is throttled", async () => {
    const calls = [];
    const res = await handleComboChat({
      body,
      models: ["p/a", "p/b"],
      handleSingleModel: async (b, m) => {
        calls.push(m);
        return m === "p/a" ? failResponse(500, "boom") : okResponse();
      },
      log,
      comboName: "combo-x",
      comboStrategy: "fallback",
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["p/a", "p/b"]);
  });
});
