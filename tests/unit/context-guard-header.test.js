import { describe, expect, it } from "vitest";
import { annotateContextGuard, contextTrimHeaderValue } from "open-sse/context-guard/header.js";

const HEADER = "x-switch-router-context-trim";

describe("contextTrimHeaderValue", () => {
  it("is null when no overflow happened", () => {
    expect(contextTrimHeaderValue(null)).toBeNull();
    expect(contextTrimHeaderValue({ overflow: false })).toBeNull();
  });

  it("describes an applied trim", () => {
    expect(contextTrimHeaderValue({
      overflow: true, trimmed: true, dropped: 7, estBefore: 301000, estAfter: 241000, inputBudget: 252000,
    })).toBe("applied; dropped=7; before=301000; after=241000; budget=252000");
  });

  it("flags the cases where the retry may still be rejected", () => {
    const value = contextTrimHeaderValue({ overflow: true, trimmed: true, dropped: 2, outputClamped: true, stillOver: true });
    expect(value).toContain("output=clamped");
    expect(value).toContain("over=true");
  });

  it("names the reason for a refusal", () => {
    expect(contextTrimHeaderValue({ overflow: true, trimmed: false, reason: "no-reliable-window" }))
      .toBe("refused; reason=no-reliable-window");
    expect(contextTrimHeaderValue({ overflow: true, trimmed: false })).toBe("refused; reason=unknown");
  });
});

describe("annotateContextGuard", () => {
  it("adds the header and exposes it to browsers", () => {
    const response = new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    annotateContextGuard(response, { overflow: true, trimmed: true, dropped: 1 });
    expect(response.headers.get(HEADER)).toBe("applied; dropped=1");
    expect(response.headers.get("Access-Control-Expose-Headers")).toBe(HEADER);
  });

  it("accepts a handler result object", () => {
    const result = { success: true, response: new Response("{}", { status: 200 }) };
    expect(annotateContextGuard(result, { overflow: true, trimmed: false, reason: "nothing-droppable" })).toBe(result);
    expect(result.response.headers.get(HEADER)).toBe("refused; reason=nothing-droppable");
  });

  it("writes nothing for a null summary", () => {
    const response = new Response("{}", { status: 200 });
    annotateContextGuard(response, null);
    expect(response.headers.has(HEADER)).toBe(false);
  });

  it("never overwrites an existing entry or duplicates the expose list", () => {
    const response = new Response("{}", { status: 200 });
    annotateContextGuard(response, { overflow: true, trimmed: false, reason: "unknown" });
    annotateContextGuard(response, { overflow: true, trimmed: true, dropped: 9 });
    expect(response.headers.get(HEADER)).toBe("refused; reason=unknown");
    expect(response.headers.get("Access-Control-Expose-Headers")).toBe(HEADER);
  });

  it("survives a response without mutable headers", () => {
    const frozen = { headers: { has: () => false, set() { throw new Error("immutable"); }, append() {} } };
    expect(() => annotateContextGuard({ response: frozen }, { overflow: true, trimmed: true, dropped: 1 })).not.toThrow();
  });
});
