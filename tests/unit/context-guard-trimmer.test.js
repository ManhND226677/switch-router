import { describe, expect, it } from "vitest";
import { planAndApplyTrim, formatTrimLog, TRIM_NOTICE } from "open-sse/context-guard/trimmer.js";
import { resolveBudget, readOutputRequest, clampOutputRequest } from "open-sse/context-guard/budget.js";
import { resolveContainer, textChars } from "open-sse/context-guard/shape.js";

// charsPerToken is 3, so 3000 chars ≈ 1000 tokens.
const fill = (n, ch = "x") => ch.repeat(n);
const tokens = chars => chars / 3;

function openaiBody(turns) {
  return { model: "stepfun/step-3.7-flash", messages: turns };
}

/** Every produced tool-call id must still have its result and vice versa. */
function danglingIds(body) {
  const { items, kind } = resolveContainer(body);
  const produced = new Set();
  const consumed = new Set();
  for (const item of items) {
    if (kind === "messages") {
      for (const call of item.tool_calls || []) produced.add(`t:${call.id}`);
      if (item.role === "tool") consumed.add(`t:${item.tool_call_id}`);
      for (const block of Array.isArray(item.content) ? item.content : []) {
        if (block?.type === "tool_use") produced.add(`t:${block.id}`);
        if (block?.type === "tool_result") consumed.add(`t:${block.tool_use_id}`);
      }
    } else if (kind === "input") {
      if (item.type === "function_call") produced.add(`c:${item.call_id}`);
      if (item.type === "function_call_output") consumed.add(`c:${item.call_id}`);
    } else {
      for (const part of item.parts || []) {
        if (part?.functionCall) produced.add(`f:${part.functionCall.id || part.functionCall.name}`);
        if (part?.functionResponse) consumed.add(`f:${part.functionResponse.id || part.functionResponse.name}`);
      }
    }
  }
  return [...produced].filter(id => !consumed.has(id)).length
    + [...consumed].filter(id => !produced.has(id)).length;
}

describe("resolveContainer / textChars", () => {
  it("finds messages, input, contents and the antigravity wrapper", () => {
    expect(resolveContainer({ messages: [] }).kind).toBe("messages");
    expect(resolveContainer({ input: [] }).kind).toBe("input");
    expect(resolveContainer({ contents: [] }).kind).toBe("contents");
    expect(resolveContainer({ request: { contents: [] } }).kind).toBe("contents");
    expect(resolveContainer({ prompt: "hi" })).toBeNull();
    expect(resolveContainer(null)).toBeNull();
  });

  it("counts string leaves only, not JSON key names", () => {
    expect(textChars({ role: "user", content: fill(100) })).toBe(104);
    expect(textChars("plain")).toBe(5);
    expect(textChars(null)).toBe(0);
    expect(textChars(42)).toBe(8);
  });
});

describe("resolveBudget", () => {
  it("prefers the numbers the upstream reported", () => {
    const body = { messages: [], max_tokens: 64000 };
    const budget = resolveBudget({
      classification: { maxContextTokens: 262144, inputTokens: 262145 },
      provider: "stepfun", model: "step-3.7-flash", body,
    });
    expect(budget.source).toBe("upstream");
    expect(budget.max).toBe(262144);
    expect(budget.margin).toBe(13108);
    // 262144 - 13108 margin - 64000 output the request still asks for
    expect(budget.inputBudget).toBe(262144 - 13108 - 64000);
    expect(budget.reportedInput).toBe(262145);
  });

  it("falls back to declared capability data", () => {
    const budget = resolveBudget({ classification: {}, provider: "stepfun", model: "step-3.7-flash", body: { messages: [] } });
    expect(budget.source).toBe("capabilities");
    expect(budget.max).toBe(256000);
  });

  it("refuses to size a request from the fabricated default window", () => {
    expect(resolveBudget({ classification: {}, provider: "some-provider", model: "brand-new-model", body: { messages: [] } })).toBeNull();
  });

  it("returns null when the window cannot even hold a margin plus output", () => {
    const budget = resolveBudget({
      classification: { maxContextTokens: 1500 },
      provider: "stepfun", model: "step-3.7-flash", body: { messages: [], max_tokens: 1400 },
    });
    expect(budget).toBeNull();
  });

  it("reads the output ceiling wherever the format carries it", () => {
    expect(readOutputRequest({ max_tokens: 100 })).toBe(100);
    expect(readOutputRequest({ max_completion_tokens: 200 })).toBe(200);
    expect(readOutputRequest({ generationConfig: { maxOutputTokens: 300 } })).toBe(300);
    expect(readOutputRequest({ request: { generationConfig: { maxOutputTokens: 400 } } })).toBe(400);
    expect(readOutputRequest({ messages: [] })).toBe(0);
  });
});

describe("planAndApplyTrim: openai messages", () => {
  const body = () => openaiBody([
    { role: "system", content: fill(300) },
    { role: "user", content: fill(3000) },
    { role: "assistant", content: fill(3000) },
    { role: "user", content: fill(3000) },
    { role: "user", content: fill(3000) },
  ]);
  const budget = () => ({ inputBudget: tokens(3600), max: 20000, margin: 1000 });

  it("drops the oldest turns and keeps the live user turn plus system", () => {
    const request = body();
    const stats = planAndApplyTrim({ body: request, budget: budget() });
    expect(stats.changed).toBe(true);
    expect(stats.reason).toBe("trimmed");
    expect(stats.itemsDropped).toBe(3);
    expect(request.messages.map(m => m.role)).toEqual(["system", "user"]);
    expect(request.messages[request.messages.length - 1].content).toBe(fill(3000));
    expect(stats.keptItems).toBe(2);
    expect(stats.estAfter).toBeLessThanOrEqual(stats.inputBudget);
  });

  it("leaves a request that already fits completely alone", () => {
    const request = body();
    const stats = planAndApplyTrim({ body: request, budget: { inputBudget: 100000, max: 200000, margin: 1000 } });
    expect(stats.changed).toBe(false);
    expect(stats.reason).toBe("already-fits");
    expect(request.messages).toHaveLength(5);
  });

  it("drops a tool call together with every result that answers it", () => {
    const request = openaiBody([
      { role: "system", content: fill(300) },
      { role: "user", content: fill(300) },
      { role: "assistant", content: null, tool_calls: [
        { id: "a1", type: "function", function: { name: "read", arguments: fill(3000) } },
        { id: "a2", type: "function", function: { name: "read", arguments: fill(3000) } },
      ] },
      { role: "tool", tool_call_id: "a1", content: fill(3000) },
      { role: "tool", tool_call_id: "a2", content: fill(3000) },
      { role: "assistant", content: fill(300) },
      { role: "user", content: fill(300) },
    ]);
    const stats = planAndApplyTrim({ body: request, budget: { inputBudget: tokens(1800), max: 20000, margin: 1000 } });
    expect(stats.groupsDropped).toBe(2);
    expect(stats.itemsDropped).toBe(4);
    expect(danglingIds(request)).toBe(0);
    expect(request.messages.map(m => m.role)).toEqual(["system", "user", "assistant", "user"]);
  });

  it("refuses to break a tool pair whose result belongs to the live turn", () => {
    const request = openaiBody([
      { role: "system", content: fill(300) },
      { role: "user", content: fill(300) },
      { role: "assistant", content: null, tool_calls: [{ id: "keep", type: "function", function: { name: "read", arguments: fill(3000) } }] },
      { role: "user", content: fill(300) },
      { role: "tool", tool_call_id: "keep", content: fill(3000) },
    ]);
    const stats = planAndApplyTrim({ body: request, budget: { inputBudget: tokens(900), max: 20000, margin: 1000 } });
    // The assistant call at index 2 reaches into the protected zone, so it is
    // blocked; only index 1 may go.
    expect(request.messages.some(m => m.role === "assistant")).toBe(true);
    expect(danglingIds(request)).toBe(0);
    expect(stats.itemsDropped).toBe(1);
  });

  it("inserts a user placeholder when the surviving history would open with an assistant turn", () => {
    const request = openaiBody([
      { role: "user", content: fill(3000) },
      { role: "assistant", content: fill(300) },
      { role: "user", content: fill(300) },
    ]);
    const stats = planAndApplyTrim({ body: request, budget: { inputBudget: 210, max: 20000, margin: 1000 } });
    expect(stats.itemsDropped).toBe(1);
    expect(request.messages[0]).toEqual({ role: "user", content: TRIM_NOTICE });
    expect(request.messages[1].content).toBe(fill(300));
  });
});

describe("planAndApplyTrim: other dispatch formats", () => {
  it("keeps Claude system blocks and tool_use/tool_result pairs intact", () => {
    const request = {
      system: [{ type: "text", text: fill(300), cache_control: { type: "ephemeral", ttl: "1h" } }],
      messages: [
        { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: fill(3000) }] },
        { role: "assistant", content: [{ type: "tool_use", id: "tu1", name: "read", input: { path: fill(3000) } }] },
        { role: "user", content: [{ type: "text", text: fill(300) }] },
        { role: "assistant", content: [{ type: "text", text: fill(300) }] },
        { role: "user", content: [{ type: "text", text: fill(300) }] },
      ],
    };
    const stats = planAndApplyTrim({ body: request, budget: { inputBudget: tokens(1200), max: 20000, margin: 1000 } });
    expect(stats.itemsDropped).toBe(2);
    expect(request.system).toHaveLength(1);
    expect(danglingIds(request)).toBe(0);
    expect(request.messages[request.messages.length - 1].role).toBe("user");
  });

  it("keeps Responses-API reasoning and instructions while dropping call/output pairs", () => {
    const request = {
      instructions: "be terse",
      input: [
        { type: "reasoning", id: "rs1", summary: [{ text: fill(300) }] },
        { type: "function_call", call_id: "fc1", name: "shell", arguments: fill(3000) },
        { type: "function_call_output", call_id: "fc1", output: fill(3000) },
        { type: "message", role: "user", content: [{ type: "input_text", text: fill(300) }] },
      ],
    };
    const stats = planAndApplyTrim({ body: request, budget: { inputBudget: tokens(600), max: 20000, margin: 1000 } });
    expect(stats.itemsDropped).toBe(2);
    expect(request.input.map(i => i.type)).toContain("reasoning");
    expect(request.instructions).toBe("be terse");
    expect(danglingIds(request)).toBe(0);
  });

  it("repairs a Gemini history that would start with a model turn", () => {
    const request = {
      systemInstruction: { parts: [{ text: fill(300) }] },
      contents: [
        { role: "user", parts: [{ text: fill(3000) }] },
        { role: "model", parts: [{ functionCall: { id: "g1", name: "lookup", args: { q: fill(3000) } } }] },
        { role: "user", parts: [{ functionResponse: { id: "g1", name: "lookup", response: { ok: fill(3000) } } }] },
        { role: "model", parts: [{ text: fill(300) }] },
        { role: "user", parts: [{ text: fill(300) }] },
      ],
    };
    const stats = planAndApplyTrim({ body: request, budget: { inputBudget: tokens(900), max: 20000, margin: 1000 } });
    expect(danglingIds(request)).toBe(0);
    expect(request.contents[0].role).toBe("user");
    expect(stats.changed).toBe(true);
    expect(request.contents[request.contents.length - 1].parts[0].text).toBe(fill(300));
  });

  it("walks the antigravity wrapper", () => {
    const request = { request: { contents: [
      { role: "user", parts: [{ text: fill(3000) }] },
      { role: "model", parts: [{ text: fill(300) }] },
      { role: "user", parts: [{ text: fill(300) }] },
    ] } };
    const stats = planAndApplyTrim({ body: request, budget: { inputBudget: 300, max: 20000, margin: 1000 } });
    expect(stats.format).toBe("contents");
    expect(stats.itemsDropped).toBe(1);
    expect(request.request.contents[0].role).toBe("user");
    expect(request.request.contents).toHaveLength(3);
  });
});

describe("planAndApplyTrim: refusal and last-resort paths", () => {
  it("reports no-container for an envelope it cannot read", () => {
    expect(planAndApplyTrim({ body: { prompt: fill(9000) }, budget: { inputBudget: 10 } }).reason).toBe("no-container");
  });

  it("reports no-budget when resolveBudget refused", () => {
    expect(planAndApplyTrim({ body: { messages: [] }, budget: null }).reason).toBe("no-budget");
  });

  it("never drops the live user turn even when nothing can fit", () => {
    const request = openaiBody([{ role: "user", content: fill(300000) }]);
    const stats = planAndApplyTrim({ body: request, budget: { inputBudget: 10, max: 262144, margin: 13000 } });
    expect(stats.exhausted).toBe(true);
    expect(request.messages).toHaveLength(1);
    expect(stats.stillOver).toBe(true);
  });

  it("clamps the output ceiling once nothing else can be cut", () => {
    const request = { ...openaiBody([{ role: "user", content: fill(300) }]), max_tokens: 3000 };
    const stats = planAndApplyTrim({ body: request, budget: { inputBudget: 50, max: 2000, margin: 100 } });
    expect(stats.exhausted).toBe(true);
    expect(stats.outputClamped).toBe(true);
    expect(request.max_tokens).toBeLessThan(3000);
    expect(stats.reason).toBe("output-clamped");
  });

  it("lowers a thinking budget that would otherwise exceed the clamped max_tokens", () => {
    const request = {
      ...openaiBody([{ role: "user", content: fill(300) }]),
      max_tokens: 9000,
      thinking: { type: "enabled", budget_tokens: 8000 },
    };
    planAndApplyTrim({ body: request, budget: { inputBudget: 50, max: 6000, margin: 500 } });
    expect(request.max_tokens).toBe(5398);
    expect(request.thinking.budget_tokens).toBe(request.max_tokens - 1024);
  });

  it("refuses to clamp the output into a range thinking cannot fit", () => {
    const request = {
      ...openaiBody([{ role: "user", content: fill(300) }]),
      max_tokens: 9000,
      thinking: { type: "enabled", budget_tokens: 8000 },
    };
    const stats = planAndApplyTrim({ body: request, budget: { inputBudget: 50, max: 2000, margin: 100 } });
    expect(stats.outputClamped).toBe(false);
    expect(request.max_tokens).toBe(9000);
    expect(request.thinking.budget_tokens).toBe(8000);
  });

  it("honours a custom maxPasses bound", () => {
    const request = openaiBody([
      { role: "user", content: fill(3000) }, { role: "assistant", content: fill(3000) },
      { role: "user", content: fill(3000) }, { role: "assistant", content: fill(3000) },
      { role: "user", content: fill(3000) }, { role: "assistant", content: fill(3000) },
      { role: "user", content: fill(300) },
    ]);
    const stats = planAndApplyTrim({ body: request, budget: { inputBudget: 100, max: 20000, margin: 1000 }, maxPasses: 2 });
    expect(stats.groupsDropped).toBe(2);
    expect(stats.exhausted).toBe(false);
    expect(stats.stillOver).toBe(true);
  });

  it("scales the drop count with the upstream-reported input size", () => {
    const make = () => openaiBody([
      { role: "user", content: fill(3000) },
      { role: "assistant", content: fill(3000) },
      { role: "user", content: fill(300) },
    ]);
    const uncalibrated = planAndApplyTrim({ body: make(), budget: { inputBudget: 1200, max: 20000, margin: 1000 } });
    // The provider says the body is 6x bigger than we guessed → drop more.
    const calibrated = planAndApplyTrim({ body: make(), budget: { inputBudget: 1200, max: 20000, margin: 1000, reportedInput: uncalibrated.estBefore * 6 } });
    expect(calibrated.calibration).toBe(6);
    expect(calibrated.itemsDropped).toBe(uncalibrated.itemsDropped + 1);
  });

  it("is fail-open: a body that throws mid-walk is left untouched", () => {
    const request = openaiBody([
      { role: "user", get content() { throw new Error("boom"); } },
      { role: "user", content: fill(300) },
    ]);
    const stats = planAndApplyTrim({ body: request, budget: { inputBudget: 10, max: 20000, margin: 100 } });
    expect(stats.changed).toBe(false);
    expect(stats.reason).toBe("error");
    expect(stats.error).toBe("boom");
    expect(request.messages).toHaveLength(2);
  });
});

describe("clampOutputRequest", () => {
  it("only lowers ceilings the body already carries", () => {
    const body = { max_tokens: 5000 };
    expect(clampOutputRequest(body, 2000)).toBe(true);
    expect(body.max_tokens).toBe(2000);
    expect(clampOutputRequest({ messages: [] }, 2000)).toBe(false);
    expect(clampOutputRequest({ max_tokens: 5000 }, 100)).toBe(false);
  });
});

describe("formatTrimLog", () => {
  it("renders a one-line summary for the request log", () => {
    const request = openaiBody([
      { role: "user", content: fill(3000) }, { role: "assistant", content: fill(3000) }, { role: "user", content: fill(300) },
    ]);
    const stats = planAndApplyTrim({ body: request, budget: { inputBudget: 100, max: 262144, margin: 13000 } });
    const line = formatTrimLog(stats);
    expect(line).toContain("[CTXGUARD]");
    expect(line).toContain("max=262144");
    expect(line).toContain("dropped 2/3 items");
    expect(formatTrimLog(null)).toBe("");
    expect(formatTrimLog({ changed: false, reason: "no-container" })).toContain("refused trim (no-container)");
  });
});
