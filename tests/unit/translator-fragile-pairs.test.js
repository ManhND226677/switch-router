/**
 * Regression tests for translator "fragile pair" fixes:
 *  - B1: string-form / missing image_url must not crash openaiToClaudeRequest
 *  - B2: tool_calls without an id must still open a Claude tool block (fallback id)
 *  - B3: non-base64 data URIs are dropped, never corrupted, for Claude and Gemini
 *  - B4: plain-text tool results are single-wrapped, not double-wrapped (OpenAI→Gemini)
 *  - B5: Claude url-source images survive the Claude→OpenAI hop
 */

import { describe, expect, it } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";
import { openaiToGeminiRequest } from "../../open-sse/translator/request/openai-to-gemini.js";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";
import { convertOpenAIContentToParts } from "../../open-sse/translator/formats/gemini.js";

function createResponseState() {
  return { toolCalls: new Map(), nextBlockIndex: 0 };
}

function getInputJsonDelta(events) {
  return events.find((event) => event.type === "content_block_delta" && event.delta?.type === "input_json_delta")?.delta.partial_json;
}

describe("B1: image_url string form does not crash openaiToClaudeRequest", () => {
  it("accepts image_url as a plain data-URI string", () => {
    const body = {
      messages: [{ role: "user", content: [{ type: "image_url", image_url: "data:image/png;base64,AAAA" }] }],
    };
    const result = openaiToClaudeRequest("claude-sonnet-4.5", body, false);
    const blocks = result.messages[0].content;
    expect(blocks[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } });
  });

  it("tolerates an image_url object with a missing url", () => {
    const body = {
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { detail: "high" } }] }],
    };
    expect(() => openaiToClaudeRequest("claude-sonnet-4.5", body, false)).not.toThrow();
  });
});

describe("B2: tool_calls without an id still open a Claude tool block", () => {
  it("emits a content_block_start with a fallback id and streams the args", () => {
    const state = createResponseState();

    const first = openaiToClaudeResponse({
      id: "chatcmpl-no-id",
      model: "test-model",
      choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "Read", arguments: "" } }] } }],
    }, state);

    const start = first.find((event) => event.type === "content_block_start" && event.content_block?.type === "tool_use");
    expect(start).toBeDefined();
    expect(start.content_block.id).toMatch(/^call_0_\d+$/);

    const events = openaiToClaudeResponse({
      id: "chatcmpl-no-id",
      model: "test-model",
      choices: [{
        delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ file_path: "F:/repo/a.js" }) } }] },
        finish_reason: "tool_calls",
      }],
    }, state);

    expect(JSON.parse(getInputJsonDelta(events))).toEqual({ file_path: "F:/repo/a.js" });
  });

  it("sanitizes ids that violate Anthropic's ^[a-zA-Z0-9_-]+$ pattern", () => {
    const state = createResponseState();
    const events = openaiToClaudeResponse({
      id: "chatcmpl-bad-id",
      model: "test-model",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "toolu:bad.id", function: { name: "Read" } }] } }],
    }, state);

    const start = events.find((event) => event.type === "content_block_start" && event.content_block?.type === "tool_use");
    expect(start).toBeDefined();
    expect(start.content_block.id).toMatch(/^[a-zA-Z0-9_-]+$/);
  });
});

describe("B3: non-base64 data URIs are dropped, never corrupted", () => {
  it("drops a non-base64 SVG data URI for Claude instead of 400ing upstream", () => {
    const body = {
      messages: [{ role: "user", content: [{ type: "image_url", image_url: "data:image/svg+xml,%3Csvg%3E%3C/svg%3E" }] }],
    };
    const result = openaiToClaudeRequest("claude-sonnet-4.5", body, false);
    const blocks = result.messages[0]?.content ?? [];
    expect(blocks.filter((b) => b.type === "image")).toHaveLength(0);
  });

  it("keeps base64 data URIs for Claude", () => {
    const body = {
      messages: [{ role: "user", content: [{ type: "image_url", image_url: "data:image/jpeg;base64,BBBB" }] }],
    };
    const result = openaiToClaudeRequest("claude-sonnet-4.5", body, false);
    expect(result.messages[0].content[0].source.data).toBe("BBBB");
  });

  it("does not emit corrupted inlineData for non-base64 data URIs in Gemini parts", () => {
    const parts = convertOpenAIContentToParts([{ type: "image_url", image_url: "data:image/svg+xml,%3Csvg%3E" }]);
    expect(parts).toHaveLength(0);
  });

  it("emits inlineData for base64 data URIs in Gemini parts", () => {
    const parts = convertOpenAIContentToParts([{ type: "image_url", image_url: "data:image/png;base64,AAAA" }]);
    expect(parts[0].inlineData).toEqual({ mime_type: "image/png", data: "AAAA" });
  });

  it("emits fileData for https image URLs in Gemini parts", () => {
    const parts = convertOpenAIContentToParts([{ type: "image_url", image_url: "https://example.com/a.png" }]);
    expect(parts[0].fileData.fileUri).toBe("https://example.com/a.png");
  });
});

describe("B4: plain-text tool results are single-wrapped for Gemini", () => {
  it("produces { result: \"text\" } instead of { result: { result: \"text\" } }", () => {
    const body = {
      messages: [
        { role: "user", content: "sum 2+2" },
        { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "calc", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call_1", content: "done: 4" },
      ],
    };
    const result = openaiToGeminiRequest("gemini-2.5-pro", body, false);
    const userParts = result.contents.find((c) => c.role === "user" && c.parts?.[0]?.functionResponse);
    expect(userParts.parts[0].functionResponse.response).toEqual({ result: "done: 4" });
  });

  it("keeps parsed JSON objects single-wrapped", () => {
    const body = {
      messages: [
        { role: "user", content: "calc" },
        { role: "assistant", content: "", tool_calls: [{ id: "call_2", type: "function", function: { name: "calc", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call_2", content: "{\"sum\": 4}" },
      ],
    };
    const result = openaiToGeminiRequest("gemini-2.5-pro", body, false);
    const userParts = result.contents.find((c) => c.role === "user" && c.parts?.[0]?.functionResponse);
    expect(userParts.parts[0].functionResponse.response).toEqual({ result: { sum: 4 } });
  });
});

describe("B5: Claude url-source images survive the Claude→OpenAI hop", () => {
  it("converts a url image source to an OpenAI image_url part", () => {
    const body = {
      messages: [{ role: "user", content: [{ type: "image", source: { type: "url", url: "https://example.com/photo.png" } }] }],
      max_tokens: 10,
    };
    const result = claudeToOpenAIRequest("gpt-4o", body, false);
    const content = result.messages[0].content;
    expect(content[0]).toEqual({ type: "image_url", image_url: { url: "https://example.com/photo.png" } });
  });
});
