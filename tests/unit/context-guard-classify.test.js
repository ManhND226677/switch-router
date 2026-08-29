import { describe, expect, it } from "vitest";
import { classifyContextOverflow, isContextOverflowText, unwrapErrorChain } from "open-sse/context-guard/errorUnwrap.js";
import fixtures from "../fixtures/upstream-errors/context-overflow.json";

describe("unwrapErrorChain", () => {
  it("walks a triple-encoded payload down to the human text", () => {
    const chain = unwrapErrorChain(fixtures.overflow[0].body);
    expect(chain.length).toBeGreaterThanOrEqual(3);
    expect(chain[chain.length - 1]).toContain("maximum context length is 262144 tokens");
  });

  it("returns the input unchanged when it is not JSON", () => {
    expect(unwrapErrorChain("Request Entity Too Large")).toEqual(["Request Entity Too Large"]);
  });

  it("caps the walk on pathologically deep nesting", () => {
    let payload = "boom";
    for (let i = 0; i < 20; i += 1) payload = JSON.stringify({ error: { message: payload } });
    const chain = unwrapErrorChain(payload);
    expect(chain.length).toBeLessThanOrEqual(7);
    expect(chain[chain.length - 1]).toContain("boom");
  });

  it("accepts an already-parsed object", () => {
    const chain = unwrapErrorChain({ error: { message: "prompt is too long: 5 > 4 maximum" } });
    expect(chain.join("\n")).toContain("prompt is too long");
  });

  it("returns an empty chain for nullish input", () => {
    expect(unwrapErrorChain(null)).toEqual([]);
    expect(unwrapErrorChain(undefined)).toEqual([]);
  });
});

describe("classifyContextOverflow", () => {
  it.each(fixtures.overflow)("$name is detected with the right numbers", ({ status, body, expect: expected }) => {
    const result = classifyContextOverflow(status, body);
    expect(result).not.toBeNull();
    for (const key of ["maxContextTokens", "inputTokens", "requestedOutputTokens"]) {
      expect(result[key] ?? null).toBe(expected[key]);
    }
  });

  it("treats `requested 0 output tokens` as no request rather than a clamp target", () => {
    const result = classifyContextOverflow(400, fixtures.overflow[0].body);
    expect(result.requestedOutputTokens).toBeUndefined();
  });

  it("reports status-only when a 413 carries no wording to parse", () => {
    expect(classifyContextOverflow(413, "Request Entity Too Large").source).toBe("status-only");
  });

  it("never classifies a non-overflow 400", () => {
    for (const { status, body } of fixtures.notOverflow) {
      expect(classifyContextOverflow(status, body), `${status} ${body}`).toBeNull();
    }
  });

  it("isContextOverflowText ignores non-strings and empty input", () => {
    expect(isContextOverflowText("")).toBe(false);
    expect(isContextOverflowText(null)).toBe(false);
    expect(isContextOverflowText(42)).toBe(false);
    expect(isContextOverflowText("Maximum Context Length is 8 tokens")).toBe(true);
  });
});
