import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Regression: Claude Code sends thinking effort "max" (its top level). When
// Switch-Router routes to an OpenAI-format provider, applyThinking() case "openai"
// must clamp "max"→"xhigh" because OpenAI's reasoning_effort enum has no "max"
// (L.openai caps at "xhigh"). Without the clamp, upstream returns HTTP 400
// "max effort not support". See open-sse/providers/thinkingLevels.js:10.
describe("applyThinking (openai): clamp max effort to xhigh", () => {
  it("client output_config.effort:\"max\" → reasoning_effort:\"xhigh\" (not \"max\")", () => {
    const body = { output_config: { effort: "max" } };
    const out = applyThinking(FORMATS.OPENAI, "gpt-5", body, "openai");
    expect(out.reasoning_effort).toBe("xhigh");
  });

  it("direct reasoning_effort:\"max\" clamped to \"xhigh\"", () => {
    const body = { reasoning_effort: "max" };
    const out = applyThinking(FORMATS.OPENAI, "gpt-5", body, "openai");
    expect(out.reasoning_effort).toBe("xhigh");
  });

  it("\"xhigh\" passes through unchanged (highest valid OpenAI level)", () => {
    const body = { reasoning_effort: "xhigh" };
    const out = applyThinking(FORMATS.OPENAI, "gpt-5", body, "openai");
    expect(out.reasoning_effort).toBe("xhigh");
  });

  it("\"high\" passes through unchanged", () => {
    const body = { reasoning_effort: "high" };
    const out = applyThinking(FORMATS.OPENAI, "gpt-5", body, "openai");
    expect(out.reasoning_effort).toBe("high");
  });

  it("max budget (thinking.budget_tokens:128000) → reasoning_effort:\"xhigh\" (budgetToLevel caps at xhigh)", () => {
    const body = { thinking: { type: "enabled", budget_tokens: 128000 } };
    const out = applyThinking(FORMATS.OPENAI, "gpt-5", body, "openai");
    expect(out.reasoning_effort).toBe("xhigh");
  });

  // Regression: WorkBuddy's chat plane validates reasoning_effort per model and
  // rejects an unrecognised value with 400 code 11150 invalid_reasoning_effort.
  // "auto" is the router's sentinel, not an OpenAI enum member, so it must be
  // omitted rather than forwarded verbatim.
  it("auto intent (thinking.type:\"enabled\" without budget) → no reasoning_effort", () => {
    const out = applyThinking(FORMATS.OPENAI, "deepseek-v4.1-flash", { thinking: { type: "enabled" } }, "workbuddy");
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("explicit reasoning_effort:\"auto\" is dropped for openai targets", () => {
    const body = { reasoning_effort: "auto" };
    const out = applyThinking(FORMATS.OPENAI, "deepseek-v4.1-flash", body, "workbuddy");
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("auto drop is generic, not WorkBuddy-only", () => {
    const out = applyThinking(FORMATS.OPENAI, "gpt-5", { thinking: { type: "enabled" } }, "openai");
    expect(out.reasoning_effort).toBeUndefined();
  });
});
