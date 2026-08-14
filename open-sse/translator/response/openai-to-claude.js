import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { ROLE, CLAUDE_BLOCK, MODEL_FALLBACK } from "../schema/index.js";
import { fromOpenAIFinish } from "../concerns/finishReason.js";
import { extractReasoningText } from "../concerns/reasoning.js";
import { fallbackToolCallId } from "../concerns/toolCall.js";

// Anthropic tool_use.id must match: ^[a-zA-Z0-9_-]+$
const TOOL_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// Legacy "proxy_" prefix used by older request translators. Response strips it
// defensively so tool names from such turns resolve back (e.g. proxy_Read → Read
// for arg sanitization). Current request translator emits no prefix ("") — strip
// is then a no-op. Kept intentionally; do NOT couple to request's empty prefix.
const CLAUDE_OAUTH_TOOL_PREFIX = "proxy_";
const OFFICE_MESSAGES_ENDPOINT = "/office/v1/messages";

function safeLogToken(value) {
  return String(value || "unknown").replace(/[^A-Za-z0-9_.:/-]/g, "_").slice(0, 80);
}

function utf8ByteLength(value) {
  return new TextEncoder().encode(String(value || "")).byteLength;
}

function summarizeJsonShape(value) {
  try {
    const parsed = JSON.parse(value);
    if (!isPlainObject(parsed)) return "non-object";
    const entries = Object.entries(parsed).map(([key, item]) => {
      const type = Array.isArray(item) ? "array" : (item === null ? "null" : typeof item);
      return `${safeLogToken(key)}:${type}`;
    });
    return entries.join(",") || "empty";
  } catch {
    return "invalid";
  }
}

// Sanitize tool call arguments to fix bad params from non-Anthropic models
function sanitizeToolArgs(toolName, argsJson) {
  const name = toolName.startsWith(CLAUDE_OAUTH_TOOL_PREFIX)
    ? toolName.slice(CLAUDE_OAUTH_TOOL_PREFIX.length)
    : toolName;
  const normalized = normalizeToolArgumentPayload(argsJson);

  if (!isPlainObject(normalized.args)) {
    // Claude tool input must be a JSON object. Do not let a malformed upstream
    // delta crash the entire client stream while it is parsing input_json_delta.
    console.warn(`[TOOLJSON] invalid arguments for ${name || "unknown"}; emitted empty object (bytes=${normalized.inputLength})`);
    return "{}";
  }

  if (normalized.recovered) {
    console.warn(`[TOOLJSON] recovered arguments for ${name || "unknown"} (bytes=${normalized.inputLength})`);
  }

  if (name === "Read") sanitizeReadArgs(normalized.args);
  return JSON.stringify(normalized.args);
}

function normalizeToolArgumentChunk(value) {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeJsonObjects(previous, incoming) {
  const merged = { ...previous };
  for (const [key, value] of Object.entries(incoming)) {
    merged[key] = isPlainObject(merged[key]) && isPlainObject(value)
      ? mergeJsonObjects(merged[key], value)
      : value;
  }
  return merged;
}

function tryParseJsonObject(value) {
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Some OpenAI-compatible streams repeat a complete arguments object on every
// chunk instead of emitting only the suffix. Keep one valid object rather than
// producing two adjacent JSON objects, which Claude clients reject.
function mergeToolArgumentChunks(previousValue, incomingValue) {
  const previous = normalizeToolArgumentChunk(previousValue);
  const incoming = normalizeToolArgumentChunk(incomingValue);
  if (!previous) return incoming;
  if (!incoming || previous === incoming) return previous;

  if (incoming.startsWith(previous)) return incoming;
  if (previous.startsWith(incoming)) return previous;

  const previousObject = tryParseJsonObject(previous);
  const incomingObject = tryParseJsonObject(incoming);
  if (previousObject && incomingObject) {
    return JSON.stringify(mergeJsonObjects(previousObject, incomingObject));
  }

  // Standard OpenAI streams send an object prefix followed by its suffix.
  return previous + incoming;
}

function findJsonObjectEnd(source, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let cursor = start; cursor < source.length; cursor++) {
    const char = source[cursor];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) return cursor;
      if (depth < 0) return -1;
    }
  }

  return -1;
}

function extractJsonObjectSnapshots(value) {
  const source = normalizeToolArgumentChunk(value);
  const candidates = [];

  // A provider can send a partial object and then restart from a complete
  // snapshot. Scan for complete objects rather than only from byte zero so a
  // valid restarted snapshot can still be recovered at stream completion.
  for (let start = 0; start < source.length; start++) {
    if (source[start] !== "{") continue;
    const end = findJsonObjectEnd(source, start);
    if (end < 0) continue;

    const raw = source.slice(start, end + 1);
    const args = tryParseJsonObject(raw);
    if (args) candidates.push({ start, end, raw, args });
  }

  if (!candidates.length) return null;

  // Nested objects are also syntactically valid JSON. Keep only maximal
  // objects, which correspond to independent tool-argument snapshots.
  const snapshots = candidates.filter((candidate) => !candidates.some((other) =>
    other !== candidate && other.start <= candidate.start && other.end >= candidate.end
  ));

  return snapshots.length > 0 ? snapshots : null;
}

function normalizeToolArgumentPayload(value) {
  const source = normalizeToolArgumentChunk(value);
  const direct = tryParseJsonObject(source);
  if (direct) return { args: direct, inputLength: source.length, recovered: false };

  const snapshots = extractJsonObjectSnapshots(source);
  if (snapshots) {
    return {
      args: snapshots.reduce((merged, snapshot) => mergeJsonObjects(merged, snapshot.args), {}),
      inputLength: source.length,
      recovered: true,
    };
  }

  return { args: null, inputLength: source.length, recovered: false };
}

function sanitizeReadArgs(args) {
  if (typeof args.limit === "string" && /^\d+$/.test(args.limit)) args.limit = Number(args.limit);
  if (typeof args.offset === "string" && /^-?\d+$/.test(args.offset)) args.offset = Number(args.offset);

  if (typeof args.limit === "number") {
    if (args.limit > 2000) args.limit = 2000;
    if (args.limit < 1) delete args.limit;
  }
  if (typeof args.offset === "number" && args.offset < 0) args.offset = 0;

  if ("pages" in args && !isValidPdfPagesArg(args.file_path, args.pages)) {
    delete args.pages;
  }
}

function isValidPdfPagesArg(filePath, pages) {
  return typeof filePath === "string" &&
    filePath.toLowerCase().endsWith(".pdf") &&
    typeof pages === "string" &&
    /^\d+(?:-\d+)?$/.test(pages);
}

// Helper: stop thinking block if started
function stopThinkingBlock(state, results) {
  if (!state.thinkingBlockStarted) return;
  results.push({
    type: "content_block_stop",
    index: state.thinkingBlockIndex
  });
  state.thinkingBlockStarted = false;
}

// Helper: stop text block if started
function stopTextBlock(state, results) {
  if (!state.textBlockStarted || state.textBlockClosed) return;
  state.textBlockClosed = true;
  results.push({
    type: "content_block_stop",
    index: state.textBlockIndex
  });
  state.textBlockStarted = false;
}

// Convert OpenAI stream chunk to Claude format
export function openaiToClaudeResponse(chunk, state) {
  if (!chunk || !chunk.choices?.[0] || state.responseFinished) return null;

  const results = [];
  const choice = chunk.choices[0];
  const delta = choice.delta;

  // Track usage from OpenAI chunk if available
  if (chunk.usage && typeof chunk.usage === "object") {
    const promptTokens = typeof chunk.usage.prompt_tokens === "number" ? chunk.usage.prompt_tokens : 0;
    const outputTokens = typeof chunk.usage.completion_tokens === "number" ? chunk.usage.completion_tokens : 0;

    // Extract cache tokens from prompt_tokens_details
    const cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens;
    const cacheCreationTokens = chunk.usage.prompt_tokens_details?.cache_creation_tokens;
    const cacheReadTokens = typeof cachedTokens === "number" ? cachedTokens : 0;
    const cacheCreateTokens = typeof cacheCreationTokens === "number" ? cacheCreationTokens : 0;

    // input_tokens = prompt_tokens - cached_tokens - cache_creation_tokens
    // Because OpenAI's prompt_tokens includes all prompt-side tokens
    const inputTokens = promptTokens - cacheReadTokens - cacheCreateTokens;

    state.usage = {
      input_tokens: inputTokens,
      output_tokens: outputTokens
    };

    // Add cache_read_input_tokens if present
    if (cacheReadTokens > 0) {
      state.usage.cache_read_input_tokens = cacheReadTokens;
    }

    // Add cache_creation_input_tokens if present
    if (cacheCreateTokens > 0) {
      state.usage.cache_creation_input_tokens = cacheCreateTokens;
    }

    // Note: completion_tokens_details.reasoning_tokens is already included in output_tokens
    // No need to add separately as Claude expects total output_tokens
  }

  // First chunk - ALWAYS send message_start first
  if (!state.messageStartSent) {
    state.messageStartSent = true;
    state.messageId = chunk.id?.replace("chatcmpl-", "") || `msg_${Date.now()}`;
    if (!state.messageId || state.messageId === "chat" || state.messageId.length < 8) {
      state.messageId = chunk.extend_fields?.requestId ||
        chunk.extend_fields?.traceId ||
        `msg_${Date.now()}`;
    }
    state.model = chunk.model || MODEL_FALLBACK;
    state.nextBlockIndex = 0;
    results.push({
      type: "message_start",
      message: {
        id: state.messageId,
        type: "message",
        role: ROLE.ASSISTANT,
        model: state.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      }
    });
  }

  // Handle reasoning (thinking) across vendor shapes - GLM/DeepSeek/Qwen/MiniMax/etc.
  const reasoningContent = extractReasoningText(delta);
  if (reasoningContent) {
    stopTextBlock(state, results);

    if (!state.thinkingBlockStarted) {
      state.thinkingBlockIndex = state.nextBlockIndex++;
      state.thinkingBlockStarted = true;
      results.push({
        type: "content_block_start",
        index: state.thinkingBlockIndex,
        content_block: { type: CLAUDE_BLOCK.THINKING, thinking: "" }
      });
    }

    results.push({
      type: "content_block_delta",
      index: state.thinkingBlockIndex,
      delta: { type: "thinking_delta", thinking: reasoningContent }
    });
  }

  // Handle regular content
  if (delta?.content) {
    stopThinkingBlock(state, results);

    if (!state.textBlockStarted) {
      state.textBlockIndex = state.nextBlockIndex++;
      state.textBlockStarted = true;
      state.textBlockClosed = false;
      results.push({
        type: "content_block_start",
        index: state.textBlockIndex,
        content_block: { type: CLAUDE_BLOCK.TEXT, text: "" }
      });
    }

    results.push({
      type: "content_block_delta",
      index: state.textBlockIndex,
      delta: { type: "text_delta", text: delta.content }
    });
  }

  // Tool calls
  if (delta?.tool_calls) {
    for (const tc of delta.tool_calls) {
      const idx = tc.index ?? 0;

      // Some OpenAI-compatible streams omit the id on the first chunk (or emit
      // ids that violate Anthropic's ^[a-zA-Z0-9_-]+$ pattern). Fall back to a
      // synthetic id so the tool call is never silently dropped from the stream.
      const rawId = tc.id;
      const toolId = rawId && TOOL_ID_PATTERN.test(rawId) ? rawId : fallbackToolCallId(idx);

      // GLM/fireworks repeats id+null-name on every arg chunk; open block once per idx
      if (!state.toolCalls.has(idx)) {
        stopThinkingBlock(state, results);
        stopTextBlock(state, results);

        const toolBlockIndex = state.nextBlockIndex++;
        state.toolCalls.set(idx, { id: toolId, name: tc.function?.name || "", blockIndex: toolBlockIndex });

        // Strip prefix from tool name for response
        let toolName = tc.function?.name || "";
        if (toolName.startsWith(CLAUDE_OAUTH_TOOL_PREFIX)) {
          toolName = toolName.slice(CLAUDE_OAUTH_TOOL_PREFIX.length);
        }

        results.push({
          type: "content_block_start",
          index: toolBlockIndex,
          content_block: {
            type: CLAUDE_BLOCK.TOOL_USE,
            id: toolId,
            name: toolName,
            input: {}
          }
        });
      }

      if (tc.function?.arguments) {
        const toolInfo = state.toolCalls.get(idx);
        if (toolInfo) {
          // Buffer args instead of streaming — sanitize at finish to fix bad params
          if (!state.toolArgBuffers) state.toolArgBuffers = new Map();
          state.toolArgBuffers.set(idx, mergeToolArgumentChunks(state.toolArgBuffers.get(idx), tc.function.arguments));
        }
      }
    }
  }

  // Finish
  if (choice.finish_reason) {
    // Some OpenAI-compatible streams emit a duplicate terminal chunk. Claude
    // clients concatenate input_json_delta strings for a content block, so
    // replaying a completed tool block would turn `{...}` into `{...}{...}`.
    state.responseFinished = true;
    stopThinkingBlock(state, results);
    stopTextBlock(state, results);

    const isOfficeStream = state.clientEndpoint === OFFICE_MESSAGES_ENDPOINT;
    for (const [idx, toolInfo] of state.toolCalls) {
      // Emit buffered + sanitized args as single delta before stop
      const buffered = state.toolArgBuffers?.get(idx);
      if (buffered) {
        const sanitized = sanitizeToolArgs(toolInfo.name, buffered);
        if (isOfficeStream) {
          console.log(
            `[OFFICE-SSE] tool=${safeLogToken(toolInfo.name)} index=${toolInfo.blockIndex} ` +
            `inputBytes=${utf8ByteLength(buffered)} outputBytes=${utf8ByteLength(sanitized)} ` +
            `shape=${summarizeJsonShape(sanitized)}`
          );
        }
        results.push({
          type: "content_block_delta",
          index: toolInfo.blockIndex,
          delta: { type: "input_json_delta", partial_json: sanitized }
        });
      } else if (isOfficeStream) {
        console.log(`[OFFICE-SSE] tool=${safeLogToken(toolInfo.name)} index=${toolInfo.blockIndex} inputBytes=0 shape=empty`);
      }
      results.push({
        type: "content_block_stop",
        index: toolInfo.blockIndex
      });
    }

    if (isOfficeStream) {
      console.log(
        `[OFFICE-SSE] complete model=${safeLogToken(state.model)} blocks=${state.nextBlockIndex || 0} ` +
        `tools=${state.toolCalls.size} finish=${safeLogToken(choice.finish_reason)}`
      );
    }

    // Mark finish for later usage injection in stream.js
    state.finishReason = choice.finish_reason;

    // Use tracked usage (will be estimated in stream.js if not valid)
    const finalUsage = state.usage || { input_tokens: 0, output_tokens: 0 };
    results.push({
      type: "message_delta",
      delta: { stop_reason: convertFinishReason(choice.finish_reason) },
      usage: finalUsage
    });
    results.push({ type: "message_stop" });
  }

  return results.length > 0 ? results : null;
}

const convertFinishReason = (reason) => fromOpenAIFinish(reason, "claude");

// Register
register(FORMATS.OPENAI, FORMATS.CLAUDE, null, openaiToClaudeResponse);
