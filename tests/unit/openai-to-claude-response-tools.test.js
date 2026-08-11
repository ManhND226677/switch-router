import { describe, expect, it, vi } from "vitest";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

function createState() {
  return { toolCalls: new Map(), nextBlockIndex: 0 };
}

function getInputJsonDelta(events) {
  return events.find((event) => event.type === "content_block_delta" && event.delta?.type === "input_json_delta")?.delta.partial_json;
}

describe("openaiToClaudeResponse tool argument sanitization", () => {
  it("drops invalid Read pages and clamps numeric bounds", () => {
    const state = createState();

    openaiToClaudeResponse({
      id: "chatcmpl-test-read",
      model: "test-model",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "toolu_read", function: { name: "Read" } }] } }],
    }, state);

    const events = openaiToClaudeResponse({
      id: "chatcmpl-test-read",
      model: "test-model",
      choices: [{
        delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ file_path: "F:/repo/file.js", offset: -5, limit: 999999999, pages: "" }) } }] },
        finish_reason: "tool_calls",
      }],
    }, state);

    expect(JSON.parse(getInputJsonDelta(events))).toEqual({
      file_path: "F:/repo/file.js",
      offset: 0,
      limit: 2000,
    });
  });

  it("keeps valid PDF pages", () => {
    const state = createState();

    openaiToClaudeResponse({
      id: "chatcmpl-test-pdf",
      model: "test-model",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "toolu_pdf", function: { name: "proxy_Read" } }] } }],
    }, state);

    const events = openaiToClaudeResponse({
      id: "chatcmpl-test-pdf",
      model: "test-model",
      choices: [{
        delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ file_path: "F:/repo/doc.pdf", pages: "1-3" }) } }] },
        finish_reason: "tool_calls",
      }],
    }, state);

    expect(JSON.parse(getInputJsonDelta(events))).toEqual({
      file_path: "F:/repo/doc.pdf",
      pages: "1-3",
    });
  });

  it("emits valid AskUserQuestion JSON when an upstream repeats a complete snapshot", () => {
    const state = createState();
    const input = {
      questions: [{
        question: "Which presentation style should be used?",
        options: ["Minimal", "Detailed"],
      }],
    };
    const snapshot = JSON.stringify(input);

    openaiToClaudeResponse({
      id: "chatcmpl-test-ask-user",
      model: "test-model",
      choices: [{
        delta: { tool_calls: [{ index: 0, id: "toolu_ask_user", function: { name: "AskUserQuestion", arguments: snapshot } }] },
      }],
    }, state);

    const events = openaiToClaudeResponse({
      id: "chatcmpl-test-ask-user",
      model: "test-model",
      choices: [{
        delta: { tool_calls: [{ index: 0, function: { arguments: snapshot } }] },
        finish_reason: "tool_calls",
      }],
    }, state);

    expect(JSON.parse(getInputJsonDelta(events))).toEqual(input);
  });

  it("repairs complete AskUserQuestion objects already concatenated in one delta", () => {
    const state = createState();
    const input = { questions: [{ question: "Continue?", options: ["Yes", "No"] }] };
    const snapshot = JSON.stringify(input);

    const events = openaiToClaudeResponse({
      id: "chatcmpl-test-concatenated",
      model: "test-model",
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: "toolu_concatenated",
            function: { name: "AskUserQuestion", arguments: snapshot + snapshot },
          }],
        },
        finish_reason: "tool_calls",
      }],
    }, state);

    expect(JSON.parse(getInputJsonDelta(events))).toEqual(input);
  });

  it("uses a cumulative AskUserQuestion snapshot instead of concatenating it", () => {
    const state = createState();
    const partial = "{\"questions\":[{\"question\":\"Choose a tone\"";
    const complete = JSON.stringify({
      questions: [{ question: "Choose a tone", options: ["Formal", "Friendly"] }],
    });

    openaiToClaudeResponse({
      id: "chatcmpl-test-cumulative",
      model: "test-model",
      choices: [{
        delta: { tool_calls: [{ index: 0, id: "toolu_cumulative", function: { name: "AskUserQuestion", arguments: partial } }] },
      }],
    }, state);

    const events = openaiToClaudeResponse({
      id: "chatcmpl-test-cumulative",
      model: "test-model",
      choices: [{
        delta: { tool_calls: [{ index: 0, function: { arguments: complete } }] },
        finish_reason: "tool_calls",
      }],
    }, state);

    expect(JSON.parse(getInputJsonDelta(events))).toEqual({
      questions: [{ question: "Choose a tone", options: ["Formal", "Friendly"] }],
    });
  });

  it("recovers a restarted AskUserQuestion snapshot after a broken prefix", () => {
    const state = createState();
    const partial = "{\"questions\":[{\"question\":\"Discard this partial snapshot\"";
    const complete = JSON.stringify({
      questions: [{ question: "Choose a tone", options: ["Formal", "Friendly"] }],
    });

    openaiToClaudeResponse({
      id: "chatcmpl-test-restarted-snapshot",
      model: "test-model",
      choices: [{
        delta: { tool_calls: [{ index: 0, id: "toolu_restarted", function: { name: "AskUserQuestion", arguments: partial } }] },
      }],
    }, state);

    const events = openaiToClaudeResponse({
      id: "chatcmpl-test-restarted-snapshot",
      model: "test-model",
      choices: [{
        delta: { tool_calls: [{ index: 0, function: { arguments: complete } }] },
        finish_reason: "tool_calls",
      }],
    }, state);

    expect(JSON.parse(getInputJsonDelta(events))).toEqual({
      questions: [{ question: "Choose a tone", options: ["Formal", "Friendly"] }],
    });
  });

  it("recovers valid JSON before non-JSON trailing data", () => {
    const state = createState();
    const input = { questions: [{ question: "Continue?", options: ["Yes", "No"] }] };
    const snapshot = JSON.stringify(input);

    const events = openaiToClaudeResponse({
      id: "chatcmpl-test-trailing-data",
      model: "test-model",
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: "toolu_trailing_data",
            function: { name: "AskUserQuestion", arguments: `${snapshot} non-json-suffix` },
          }],
        },
        finish_reason: "tool_calls",
      }],
    }, state);

    expect(JSON.parse(getInputJsonDelta(events))).toEqual(input);
  });

  it("emits an empty object for irrecoverable tool arguments", () => {
    const state = createState();

    const events = openaiToClaudeResponse({
      id: "chatcmpl-test-invalid-json",
      model: "test-model",
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: "toolu_invalid_json",
            function: { name: "AskUserQuestion", arguments: "{\"questions\":[" },
          }],
        },
        finish_reason: "tool_calls",
      }],
    }, state);

    expect(getInputJsonDelta(events)).toBe("{}");
    expect(() => JSON.parse(getInputJsonDelta(events))).not.toThrow();
  });

  it("does not replay a tool input when an upstream repeats its finish chunk", () => {
    const state = createState();
    const snapshot = JSON.stringify({ questions: [{ question: "Continue?" }] });

    const first = openaiToClaudeResponse({
      id: "chatcmpl-test-duplicate-finish",
      model: "test-model",
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: "toolu_duplicate_finish",
            function: { name: "AskUserQuestion", arguments: snapshot },
          }],
        },
        finish_reason: "tool_calls",
      }],
    }, state);

    const duplicate = openaiToClaudeResponse({
      id: "chatcmpl-test-duplicate-finish",
      model: "test-model",
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
    }, state);

    expect(JSON.parse(getInputJsonDelta(first))).toEqual({ questions: [{ question: "Continue?" }] });
    expect(duplicate).toBeNull();
  });

  it("logs Office tool metadata without logging argument content", () => {
    const state = { ...createState(), clientEndpoint: "/office/v1/messages" };
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const secretQuestion = "CONFIDENTIAL_OFFICE_QUESTION";

    try {
      openaiToClaudeResponse({
        id: "chatcmpl-test-office-metadata",
        model: "test-model",
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: "toolu_office_metadata",
              function: {
                name: "AskUserQuestion",
                arguments: JSON.stringify({ questions: [{ question: secretQuestion, options: ["A", "B"] }] }),
              },
            }],
          },
          finish_reason: "tool_calls",
        }],
      }, state);

      const logs = logSpy.mock.calls.flat().join("\n");
      expect(logs).toContain("[OFFICE-SSE] tool=AskUserQuestion");
      expect(logs).toContain("shape=questions:array");
      expect(logs).toContain("[OFFICE-SSE] complete");
      expect(logs).not.toContain(secretQuestion);
      expect(logs).not.toContain('"options"');
    } finally {
      logSpy.mockRestore();
    }
  });

  it("continues to join ordinary argument fragments", () => {
    const state = createState();

    openaiToClaudeResponse({
      id: "chatcmpl-test-fragments",
      model: "test-model",
      choices: [{
        delta: { tool_calls: [{ index: 0, id: "toolu_fragments", function: { name: "AskUserQuestion", arguments: "{\"questions\":[" } }] },
      }],
    }, state);

    const events = openaiToClaudeResponse({
      id: "chatcmpl-test-fragments",
      model: "test-model",
      choices: [{
        delta: { tool_calls: [{ index: 0, function: { arguments: "{\"question\":\"Continue?\"}]}" } }] },
        finish_reason: "tool_calls",
      }],
    }, state);

    expect(JSON.parse(getInputJsonDelta(events))).toEqual({
      questions: [{ question: "Continue?" }],
    });
  });
});
