// Cause-bucket classifier for Error Analytics. Cases below are the real
// upstream messages observed in /api/usage/errors (2026-08 window), so the
// bucketing of known failures is pinned, not hypothetical.
import { describe, it, expect } from "vitest";
import { classifyErrorBucket, aggregateErrorBuckets, ERROR_BUCKETS } from "@/lib/db/helpers/errorBuckets.js";

describe("classifyErrorBucket", () => {
  it.each([
    // quota / rate limit
    [429, "Resource has been exhausted (e.g. check quota).", "quota"],
    [429, "Error from provider (Console): Rate limit exceeded. Please try again later.", "quota"],
    [429, '{"code":14003,"msg":"too many requests","requestId":"05eecf92"}', "quota"],
    [0, "quota exceeded for this account", "quota"],
    // context overflow
    [400, '{"detail":"{\\"stage\\":\\"decode\\",\\"message\\":{\\"type\\":\\"error\\",\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"This model\'s maximum context length"}', "context"],
    [400, "This model's maximum context length is 200000 tokens. Your messages resulted in 214500 tokens.", "context"],
    // modality mismatch
    [400, "Qwen3.8 open checkpoint is text-only; messages[0].content[1] must be a text part", "modality"],
    // payload bugs
    [400, '{"type":"error","error":{"type":"invalid_request_error","message":"messages.4.content.1: each tool_use must have a single result. Found multiple `tool_result` blocks"}}', "payload"],
    [400, null, "payload"],
    [422, "", "payload"],
    // auth / config
    [403, "Please subscribe to model in the API Key: kimi-k3-free", "config"],
    [401, "Invalid API key provided", "config"],
    [402, "Payment required", "config"],
    // network
    [502, "fetch connect timeout", "network"],
    [0, "fetch failed", "network"],
    [504, "", "network"],
    // upstream down / capacity
    [503, "No capacity available for model gemini-2.5-pro on the server", "upstream"],
    [400, "Error from provider (Console): Upstream request failed: Model is unavailable.", "upstream"],
    [500, "", "upstream"],
    [529, "Overloaded", "upstream"],
    // fallback
    [0, "", "network"], // never got an upstream response = transport failure
    [null, null, "other"],
    [418, "teapot surprise", "other"],
  ])("status=%s message=%s → %s", (status, message, expected) => {
    expect(classifyErrorBucket(status, message)).toBe(expected);
  });

  it("message patterns win over status fallbacks (503 + timeout → network)", () => {
    expect(classifyErrorBucket(503, "request timed out waiting for connection")).toBe("network");
  });
});

describe("aggregateErrorBuckets", () => {
  it("counts per bucket, sorts desc and reports share of total", () => {
    const rows = [
      { status: 429, message: "quota" },
      { status: 429, message: "rate limit" },
      { status: 429, message: "too many requests" },
      { status: 400, message: "maximum context length" },
      { status: 502, message: "fetch connect timeout" },
    ];
    const buckets = aggregateErrorBuckets(rows);
    expect(buckets[0]).toEqual({ bucket: "quota", count: 3, share: 60 });
    expect(buckets.map((b) => b.bucket)).toEqual(["quota", "context", "network"]);
  });

  it("handles empty input", () => {
    expect(aggregateErrorBuckets([])).toEqual([]);
  });

  it("only emits known bucket keys", () => {
    const rows = [
      { status: 429, message: "x" },
      { status: 400, message: "y" },
      { status: null, message: "" },
    ];
    for (const { bucket } of aggregateErrorBuckets(rows)) {
      expect(ERROR_BUCKETS).toContain(bucket);
    }
  });
});
