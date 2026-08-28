import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { HTTP_STATUS, FETCH_CONNECT_TIMEOUT_MS, STREAM_FIRST_CHUNK_TIMEOUT_MS } from "../config/runtimeConfig.js";
import {
  generateCursorBody,
  parseConnectRPCFrame,
  extractTextFromResponse
} from "../utils/cursorProtobuf.js";
import { buildCursorHeaders } from "../utils/cursorChecksum.js";
import { estimateUsage } from "../utils/usageTracking.js";
import { SSE_DONE, SSE_HEADERS } from "../utils/sseConstants.js";
import { chatChunkSse } from "../utils/sse.js";
import { FORMATS } from "../translator/formats.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import zlib from "zlib";

// Detect cloud environment
const isCloudEnv = () => {
  if (typeof caches !== "undefined" && typeof caches === "object") return true;
  if (typeof EdgeRuntime !== "undefined") return true;
  return false;
};

// Lazy import http2 (only in Node.js environment)
let http2 = null;
if (!isCloudEnv()) {
  try {
    http2 = await import("http2");
  } catch {
    // http2 not available
  }
}

const COMPRESS_FLAG = {
  NONE: 0x00,
  GZIP: 0x01,
  TRAILER: 0x02,
  GZIP_TRAILER: 0x03
};

const CURSOR_STREAM_DEBUG = process.env.CURSOR_STREAM_DEBUG === "1";
const debugLog = (...args) => {
  if (CURSOR_STREAM_DEBUG) console.log(...args);
};

// ── Persistent HTTP/2 session pool ──────────────────────────────────────────
// One TLS+HTTP/2 handshake per origin instead of per request (the old executor
// connected AND closed a session for every call). Idle sessions are reaped so
// a dead origin doesn't hold sockets open.
const HTTP2_POOL_IDLE_MS = 60_000;
if (!global._cursorHttp2Pool) global._cursorHttp2Pool = new Map();
const http2Pool = global._cursorHttp2Pool;

function dropPooledCursorSession(origin, entry) {
  if (http2Pool.get(origin) !== entry) return;
  http2Pool.delete(origin);
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
}

function touchCursorSessionIdle(entry, origin) {
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => {
    if (http2Pool.get(origin) === entry) http2Pool.delete(origin);
    try { entry.client.close(); } catch { /* already closed */ }
  }, HTTP2_POOL_IDLE_MS);
  entry.idleTimer.unref?.();
}

function getPooledCursorClient(origin) {
  const existing = http2Pool.get(origin);
  if (existing && !existing.client.destroyed && !existing.client.closed) {
    touchCursorSessionIdle(existing, origin);
    return existing.client;
  }
  if (existing) dropPooledCursorSession(origin, existing);

  const client = http2.connect(origin);
  const entry = { client, idleTimer: null };
  client.on("error", () => {
    // A broken session must never be reused; destroy so the closed check above fails fast.
    if (http2Pool.get(origin) === entry) http2Pool.delete(origin);
    try { client.destroy(); } catch { /* noop */ }
  });
  client.on("close", () => dropPooledCursorSession(origin, entry));
  http2Pool.set(origin, entry);
  touchCursorSessionIdle(entry, origin);
  return client;
}

function isComposerModel(model) {
  const modelId = String(model || "").split("/").pop();
  return /^composer(?:-|$)/i.test(modelId);
}

function visibleComposerContentFromThinking(thinking) {
  if (!thinking) return "";
  const endTag = "</think>";
  const endIdx = thinking.lastIndexOf(endTag);
  if (endIdx < 0) return "";
  return thinking.slice(endIdx + endTag.length).trimStart();
}

function decompressPayload(payload, flags) {
  // Check if payload is JSON error (starts with {"error")
  if (payload.length > 10 && payload[0] === 0x7b && payload[1] === 0x22) {
    try {
      const text = payload.toString("utf-8");
      if (text.startsWith('{"error"')) {
        debugLog(`[DECOMPRESS] Detected JSON error, skipping decompression`);
        return payload;
      }
    } catch {}
  }

  if (
    flags === COMPRESS_FLAG.GZIP ||
    flags === COMPRESS_FLAG.TRAILER ||
    flags === COMPRESS_FLAG.GZIP_TRAILER
  ) {
    // Primary: try gzip decompression (standard gzip header 0x1f 0x8b)
    try {
      return zlib.gunzipSync(payload);
    } catch (gzipErr) {
      // Fallback: TRAILER and GZIP_TRAILER frames sometimes use raw zlib deflate format
      try {
        return zlib.inflateSync(payload);
      } catch (deflateErr) {
        // Last resort: try raw deflate (no zlib header)
        try {
          return zlib.inflateRawSync(payload);
        } catch (rawErr) {
          debugLog(
            `[DECOMPRESS ERROR] flags=${flags}, payloadSize=${payload.length}, gzip=${gzipErr.message}, deflate=${deflateErr.message}, raw=${rawErr.message}`
          );
          debugLog(
            `[DECOMPRESS ERROR] First 50 bytes (hex):`,
            payload.slice(0, 50).toString("hex")
          );
          return payload;
        }
      }
    }
  }
  return payload;
}

// Read one cursor protobuf frame: header + bounds + decompress. Returns status + payload + new offset.
function readCursorFrame(buffer, offset, frameNum, tag) {
  if (offset + 5 > buffer.length) {
    debugLog(`[CURSOR BUFFER${tag}] Reached end, offset=${offset}, remaining=${buffer.length - offset}`);
    return { status: "done" };
  }

  const flags = buffer[offset];
  const length = buffer.readUInt32BE(offset + 1);
  debugLog(`[CURSOR BUFFER${tag}] Frame ${frameNum + 1}: flags=0x${flags.toString(16).padStart(2, "0")}, length=${length}`);

  if (offset + 5 + length > buffer.length) {
    debugLog(`[CURSOR BUFFER${tag}] Incomplete frame, offset=${offset}, length=${length}, buffer.length=${buffer.length}`);
    return { status: "done" };
  }

  let payload = buffer.slice(offset + 5, offset + 5 + length);
  const newOffset = offset + 5 + length;
  payload = decompressPayload(payload, flags);
  if (!payload) {
    debugLog(`[CURSOR BUFFER${tag}] Frame ${frameNum + 1}: decompression failed, skipping`);
    return { status: "skip", offset: newOffset };
  }
  return { status: "ok", payload, offset: newOffset };
}

function createErrorResponse(jsonError) {
  const errorMsg = jsonError?.error?.details?.[0]?.debug?.details?.title
    || jsonError?.error?.details?.[0]?.debug?.details?.detail
    || jsonError?.error?.message
    || "API Error";

  const isRateLimit = jsonError?.error?.code === "resource_exhausted";

  return new Response(JSON.stringify({
    error: {
      message: errorMsg,
      type: isRateLimit ? "rate_limit_error" : "api_error",
      code: jsonError?.error?.details?.[0]?.debug?.error || "unknown"
    }
  }), {
    status: isRateLimit ? HTTP_STATUS.RATE_LIMITED : HTTP_STATUS.BAD_REQUEST,
    headers: { "Content-Type": "application/json" }
  });
}

// Thrown when an error frame arrives BEFORE any output was produced — the
// caller must surface a real error Response (429/400) instead of a broken
// 200 stream. Mirrors the old buffered executor's early-return behavior.
class CursorEarlyError extends Error {
  constructor(response) {
    super("cursor-early-error");
    this.cursorErrorResponse = response;
  }
}

// ── Frame → SSE translation (shared by buffered and streaming paths) ────────
function createCursorSseState(model) {
  return {
    model,
    responseId: `chatcmpl-cursor-${Date.now()}`,
    created: Math.floor(Date.now() / 1000),
    producedChunks: 0,
    frameCount: 0,
    totalContent: "",
    totalThinking: "",
    emittedComposerThinkingContentLength: 0,
    toolCalls: [],
    toolCallsMap: new Map(), // Track streaming tool calls by ID
    finalizedIds: new Set(),
    emittedToolCallIds: new Set(),
  };
}

// Process ONE decoded payload frame; appends SSE strings to `out`.
// Returns { stop: true } when an error frame arrived after content — the
// caller must stop reading upstream and finalize. Throws CursorEarlyError for
// error frames that arrive before any output.
function processCursorFrame(payload, state, out) {
  const push = (str) => { state.producedChunks++; out.push(str); };
  const { responseId, created, model } = state;

  // Check for JSON error frames (byte-guard: only decode if starts with '{')
  if (payload[0] === 0x7b) {
    try {
      const text = payload.toString("utf-8");
      if (text.includes('"error"')) {
        const hasContent = state.producedChunks > 0 || state.totalContent || state.toolCallsMap.size > 0;
        debugLog(`[CURSOR SSE] Error frame (hasContent=${hasContent}): ${text.slice(0, 500)}`);
        if (hasContent) {
          return { stop: true };
        }
        throw new CursorEarlyError(createErrorResponse(JSON.parse(text)));
      }
    } catch (e) {
      if (e instanceof CursorEarlyError) throw e;
    }
  }

  const result = extractTextFromResponse(new Uint8Array(payload));
  debugLog(`[CURSOR DECODED SSE] Frame ${state.frameCount}:`, result);

  if (result.error) {
    const hasContent = state.producedChunks > 0 || state.totalContent || state.toolCallsMap.size > 0;
    debugLog(`[CURSOR SSE] Decoded error (hasContent=${hasContent}): ${result.error}`);
    if (hasContent) {
      return { stop: true };
    }
    throw new CursorEarlyError(new Response(
      JSON.stringify({
        error: {
          message: result.error,
          type: "rate_limit_error",
          code: "rate_limited"
        }
      }),
      {
        status: HTTP_STATUS.RATE_LIMITED,
        headers: { "Content-Type": "application/json" }
      }
    ));
  }

  if (result.toolCall) {
    const tc = result.toolCall;

    if (state.producedChunks === 0) {
      push(chatChunkSse({ id: responseId, created, model, delta: { role: "assistant", content: "" } }));
    }

    if (state.toolCallsMap.has(tc.id)) {
      // Accumulate arguments for existing tool call
      const existing = state.toolCallsMap.get(tc.id);
      existing.function.arguments += tc.function.arguments;
      existing.isLast = tc.isLast;

      // Stream the delta arguments
      if (tc.function.arguments) {
        state.emittedToolCallIds.add(tc.id);
        push(chatChunkSse({
          id: responseId, created, model,
          delta: {
            tool_calls: [
              {
                index: existing.index,
                id: tc.id,
                type: "function",
                function: {
                  name: tc.function.name,
                  arguments: tc.function.arguments
                }
              }
            ]
          }
        }));
      }
    } else {
      // New tool call - assign index and add to map
      const toolCallIndex = state.toolCalls.length;
      state.finalizedIds.add(tc.id);
      state.toolCalls.push({ ...tc, index: toolCallIndex });
      state.toolCallsMap.set(tc.id, { ...tc, index: toolCallIndex });

      // Stream initial tool call with name
      state.emittedToolCallIds.add(tc.id);
      push(chatChunkSse({
        id: responseId, created, model,
        delta: {
          tool_calls: [
            {
              index: toolCallIndex,
              id: tc.id,
              type: "function",
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments
              }
            }
          ]
        }
      }));
    }
  }

  if (result.text) {
    state.totalContent += result.text;
    push(chatChunkSse({
      id: responseId, created, model,
      delta:
        state.producedChunks === 0 && state.toolCalls.length === 0
          ? { role: "assistant", content: result.text }
          : { content: result.text }
    }));
  }

  if (isComposerModel(model) && result.thinking) {
    state.totalThinking += result.thinking;
    const visibleContent = visibleComposerContentFromThinking(state.totalThinking);
    if (visibleContent.length > state.emittedComposerThinkingContentLength) {
      const deltaContent = visibleContent.slice(state.emittedComposerThinkingContentLength);
      state.emittedComposerThinkingContentLength = visibleContent.length;
      state.totalContent += deltaContent;
      push(chatChunkSse({
        id: responseId, created, model,
        delta:
          state.producedChunks === 0 && state.toolCalls.length === 0
            ? { role: "assistant", content: deltaContent }
            : { content: deltaContent }
      }));
    }
  }

  return { stop: false };
}

// Terminal SSE chunks: remaining (never-finalized) tool calls, the placeholder
// first chunk for empty streams, the finish chunk with usage, and [DONE].
function finalizeCursorSse(state, body) {
  const { responseId, created, model } = state;
  const out = [];

  for (const [id, tc] of state.toolCallsMap.entries()) {
    if (!state.finalizedIds.has(id)) {
      debugLog(`[CURSOR SSE] Finalizing incomplete tool call: ${id}, isLast=${tc.isLast}`);
      const toolCallIndex = state.toolCalls.length;
      state.toolCalls.push({
        id: tc.id,
        type: tc.type,
        index: toolCallIndex,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments
        }
      });

      // Emit SSE chunk for the finalized tool call if not already emitted
      if (!state.emittedToolCallIds.has(tc.id)) {
        out.push(chatChunkSse({
          id: responseId, created, model,
          delta: {
            tool_calls: [
              {
                index: toolCallIndex,
                id: tc.id,
                type: "function",
                function: {
                  name: tc.function.name,
                  arguments: tc.function.arguments
                }
              }
            ]
          }
        }));
      }
    }
  }

  if (state.producedChunks === 0 && state.toolCalls.length === 0) {
    out.push(chatChunkSse({ id: responseId, created, model, delta: { role: "assistant", content: "" } }));
  }

  const usage = estimateUsage(body, state.totalContent.length, FORMATS.OPENAI);

  out.push(
    `data: ${JSON.stringify({
      id: responseId,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: state.toolCalls.length > 0 ? "tool_calls" : "stop"
        }
      ],
      usage
    })}\n\n`
  );
  out.push(SSE_DONE);
  return out;
}

// Normalize an upstream byte source (web ReadableStream from fetch, or a Node
// http2 stream) into an async iterable plus a cancel function.
function toCursorAsyncIterable(byteStream) {
  if (typeof byteStream?.getReader === "function") {
    const reader = byteStream.getReader();
    return {
      iter: (async function* () {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) return;
            yield value;
          }
        } finally {
          try { reader.releaseLock(); } catch { /* noop */ }
        }
      })(),
      cancel: async () => { try { await reader.cancel(); } catch { /* noop */ } },
    };
  }
  const nodeStream = byteStream;
  return {
    iter: (async function* () {
      try {
        for await (const chunk of nodeStream) yield chunk;
      } finally {
        try { nodeStream.destroy?.(); } catch { /* noop */ }
      }
    })(),
    cancel: async () => {
      try { nodeStream.close?.(http2?.constants?.NGHTTP2_CANCEL ?? 8); } catch { /* noop */ }
      try { nodeStream.destroy?.(); } catch { /* noop */ }
    },
  };
}

export class CursorExecutor extends BaseExecutor {
  constructor() {
    super("cursor", PROVIDERS.cursor);
  }

  buildUrl() {
    return `${this.config.baseUrl}${this.config.chatPath}`;
  }

  buildHeaders(credentials) {
    const accessToken = credentials.accessToken;
    const machineId = credentials.providerSpecificData?.machineId;
    const ghostMode = credentials.providerSpecificData?.ghostMode !== false;

    if (!machineId) {
      throw new Error("Machine ID is required for Cursor API");
    }

    return buildCursorHeaders(accessToken, machineId, ghostMode);
  }

  transformRequest(model, body, stream, credentials) {
    // Messages are already translated by chatCore (claude→openai→cursor)
    // Do NOT call openaiToCursorRequest again — double-translation drops tool_results
    const messages = body.messages || [];
    const tools = body.tools || [];
    const reasoningEffort = body.reasoning_effort || null;
    // Detect Claude Code UA to force Agent mode (issue #643)
    const ua = credentials?.rawHeaders?.["user-agent"] || "";
    const forceAgentMode = ua.includes("claude-cli") || ua.includes("claude-code") || ua.includes("Claude Code");
    return generateCursorBody(messages, model, tools, reasoningEffort, forceAgentMode);
  }

  async makeFetchStreamRequest(url, headers, body, signal, proxyOptions = null) {
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body,
      signal
    }, proxyOptions);

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      byteStream: response.body
    };
  }

  // Streaming HTTP/2 request over a POOLED session. Resolves as soon as
  // response headers arrive; the body stays streaming in `byteStream`.
  makeHttp2StreamRequest(url, headers, body, signal) {
    if (!http2) {
      throw new Error("http2 module not available");
    }

    const urlObj = new URL(url);
    const client = getPooledCursorClient(`https://${urlObj.host}`);

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn) => (...args) => {
        if (settled) return;
        settled = true;
        clearTimeout(headersTimer);
        fn(...args);
      };

      const req = client.request({
        ":method": "POST",
        ":path": `${urlObj.pathname}${urlObj.search || ""}`,
        ":authority": urlObj.host,
        ":scheme": "https",
        ...headers
      });

      // Response headers must arrive within the connect timeout (matches BaseExecutor).
      const headersTimer = setTimeout(() => {
        finish(() => reject(new Error("fetch connect timeout")));
        try { req.close(); } catch { /* noop */ }
      }, FETCH_CONNECT_TIMEOUT_MS);
      headersTimer.unref?.();

      req.on("response", (hdrs) => {
        finish(() => resolve({ status: hdrs[":status"], headers: hdrs, byteStream: req }));
      });
      req.on("error", finish((err) => reject(err)));

      if (signal) {
        signal.addEventListener("abort", () => {
          finish(() => reject(new Error("Request aborted")));
          try { req.close(http2.constants?.NGHTTP2_CANCEL ?? 8); } catch { /* noop */ }
        }, { once: true });
      }

      req.end(body);
    });
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const url = this.buildUrl();
    const headers = this.buildHeaders(credentials);
    const transformedBody = this.transformRequest(model, body, stream, credentials);

    try {
      const shouldForceFetch = proxyOptions?.enabled === true || proxyOptions?.connectionProxyEnabled === true;
      const upstream = (http2 && !shouldForceFetch)
        ? await this.makeHttp2StreamRequest(url, headers, transformedBody, signal)
        : await this.makeFetchStreamRequest(url, headers, transformedBody, signal, proxyOptions);

      if (upstream.status !== 200) {
        const errorText = upstream.byteStream
          ? (await readCursorStreamFully(upstream.byteStream)).toString()
          : "Unknown error";
        const errorResponse = new Response(JSON.stringify({
          error: {
            message: `[${upstream.status}]: ${errorText}`,
            type: "invalid_request_error",
            code: ""
          }
        }), {
          status: upstream.status,
          headers: { "Content-Type": "application/json" }
        });
        return { response: errorResponse, url, headers, transformedBody: body };
      }

      if (stream === false) {
        const buffer = await readCursorStreamFully(upstream.byteStream);
        return { response: this.transformProtobufToJSON(buffer, model, body), url, headers, transformedBody: body };
      }

      return await this.buildStreamingSseResponse(upstream, url, headers, model, body);
    } catch (error) {
      const errorResponse = new Response(JSON.stringify({
        error: {
          message: error.message,
          type: "connection_error",
          code: ""
        }
      }), {
        status: HTTP_STATUS.SERVER_ERROR,
        headers: { "Content-Type": "application/json" }
      });
      return { response: errorResponse, url, headers, transformedBody: body };
    }
  }

  // True streaming: SSE chunks are forwarded as upstream frames arrive, so
  // TTFT is the first upstream frame instead of the whole generation.
  async buildStreamingSseResponse(upstream, url, headers, model, body) {
    const { iter, cancel } = toCursorAsyncIterable(upstream.byteStream);
    const state = createCursorSseState(model);
    const gen = streamCursorSseChunks(iter, state, body);

    // Primer: pull until the first SSE output is ready (or a terminal error).
    // This preserves the buffered executor's semantics — an error frame before
    // any content becomes a real error Response, not a broken 200 stream.
    let first;
    try {
      first = await cursorFirstChunkWithTimeout(gen, cancel);
    } catch (err) {
      try { await cancel(); } catch { /* noop */ }
      if (err?.cursorErrorResponse) {
        return { response: err.cursorErrorResponse, url, headers, transformedBody: body };
      }
      throw err;
    }

    if (first.done) {
      return {
        response: new Response(first.value || "", { status: 200, headers: { ...SSE_HEADERS } }),
        url, headers, transformedBody: body,
      };
    }

    const encoder = new TextEncoder();
    let primed = { value: first.value };
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          if (primed) {
            controller.enqueue(encoder.encode(primed.value));
            primed = null;
            return;
          }
          const { done, value } = await gen.next();
          if (done) controller.close();
          else controller.enqueue(encoder.encode(value));
        } catch (err) {
          try { await cancel(); } catch { /* noop */ }
          controller.error(err);
        }
      },
      async cancel() {
        try { await gen.return(undefined); } catch { /* noop */ }
        try { await cancel(); } catch { /* noop */ }
      },
    });

    return { response: new Response(stream, { status: 200, headers: { ...SSE_HEADERS } }), url, headers, transformedBody: body };
  }

  transformProtobufToJSON(buffer, model, body) {
    const responseId = `chatcmpl-cursor-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    let offset = 0;
    let totalContent = "";
    let totalThinking = "";
    const toolCalls = [];
    const toolCallsMap = new Map(); // Track streaming tool calls by ID
    const finalizedIds = new Set();
    let frameCount = 0;

    debugLog(`[CURSOR BUFFER] Total length: ${buffer.length} bytes`);

    while (offset < buffer.length) {
      const frame = readCursorFrame(buffer, offset, frameCount, "");
      if (frame.status === "done") break;
      offset = frame.offset;
      frameCount++;
      if (frame.status === "skip") continue;
      const payload = frame.payload;

      // Check for JSON error frames (byte guard: skip toString on non-JSON frames)
      if (payload.length > 0 && payload[0] === 0x7b) {
        try {
          const text = payload.toString("utf-8");
          if (text.includes('"error"')) {
            const hasContent = totalContent || toolCallsMap.size > 0;
            debugLog(
              `[CURSOR BUFFER] Error frame (hasContent=${hasContent}): ${text.slice(0, 500)}`
            );
            if (hasContent) {
              break;
            }
            return createErrorResponse(JSON.parse(text));
          }
        } catch {}
      }

      const result = extractTextFromResponse(new Uint8Array(payload));
      debugLog(`[CURSOR DECODED] Frame ${frameCount}:`, result);

      if (result.error) {
        const hasContent = totalContent || toolCallsMap.size > 0;
        debugLog(`[CURSOR BUFFER] Decoded error (hasContent=${hasContent}): ${result.error}`);
        if (hasContent) {
          break;
        }
        return new Response(
          JSON.stringify({
            error: {
              message: result.error,
              type: "rate_limit_error",
              code: "rate_limited"
            }
          }),
          {
            status: HTTP_STATUS.RATE_LIMITED,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      if (result.toolCall) {
        const tc = result.toolCall;

        if (toolCallsMap.has(tc.id)) {
          // Accumulate arguments for existing tool call
          const existing = toolCallsMap.get(tc.id);
          existing.function.arguments += tc.function.arguments;
          existing.isLast = tc.isLast;
        } else {
          // New tool call
          toolCallsMap.set(tc.id, { ...tc });
        }

        // Push to final array when isLast is true
        if (tc.isLast) {
          const finalToolCall = toolCallsMap.get(tc.id);
          finalizedIds.add(tc.id);
          toolCalls.push({
            id: finalToolCall.id,
            type: finalToolCall.type,
            function: {
              name: finalToolCall.function.name,
              arguments: finalToolCall.function.arguments
            }
          });
        }
      }

      if (result.text) totalContent += result.text;
      if (result.thinking) totalThinking += result.thinking;
    }

    const visibleComposerContent = isComposerModel(model)
      ? visibleComposerContentFromThinking(totalThinking)
      : "";
    const finalContent = totalContent || visibleComposerContent;

    debugLog(
      `[CURSOR BUFFER] Parsed ${frameCount} frames, toolCallsMap size: ${toolCallsMap.size}, finalized toolCalls: ${toolCalls.length}`
    );

    // Finalize all remaining tool calls in map (in case stream ended without isLast=true)
    for (const [id, tc] of toolCallsMap.entries()) {
      // Check if already in final array
      if (!finalizedIds.has(id)) {
        debugLog(`[CURSOR BUFFER] Finalizing incomplete tool call: ${id}, isLast=${tc.isLast}`);
        toolCalls.push({
          id: tc.id,
          type: tc.type,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments
          }
        });
      }
    }

    debugLog(`[CURSOR BUFFER] Final toolCalls count: ${toolCalls.length}`);


    const message = {
      role: "assistant",
      content: finalContent || null
    };

    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }

    const usage = estimateUsage(body, finalContent.length, FORMATS.OPENAI);

    const completion = {
      id: responseId,
      object: "chat.completion",
      created,
      model,
      choices: [{
        index: 0,
        message,
        finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop"
      }],
      usage
    };

    return new Response(JSON.stringify(completion), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Buffered variant kept for compatibility (tests, non-first-byte paths):
  // identical per-frame semantics to the streaming path.
  transformProtobufToSSE(buffer, model, body) {
    const state = createCursorSseState(model);
    const chunks = [];
    let offset = 0;

    debugLog(`[CURSOR BUFFER SSE] Total length: ${buffer.length} bytes`);

    while (offset < buffer.length) {
      const frame = readCursorFrame(buffer, offset, state.frameCount, " SSE");
      if (frame.status === "done") break;
      offset = frame.offset;
      state.frameCount++;
      if (frame.status === "skip") continue;
      try {
        const { stop } = processCursorFrame(frame.payload, state, chunks);
        if (stop) break;
      } catch (e) {
        if (e instanceof CursorEarlyError) return e.cursorErrorResponse;
        throw e;
      }
    }

    debugLog(
      `[CURSOR BUFFER SSE] Parsed ${state.frameCount} frames, toolCallsMap size: ${state.toolCallsMap.size}, toolCalls array: ${state.toolCalls.length}`
    );

    chunks.push(...finalizeCursorSse(state, body));

    return new Response(chunks.join(""), {
      status: 200,
      headers: { ...SSE_HEADERS }
    });
  }

  async refreshCredentials() {
    return null;
  }
}

// Async generator: consume upstream bytes, parse complete frames as they
// arrive, yield SSE strings incrementally. Throws CursorEarlyError only when
// nothing has been emitted yet; late error frames finalize the stream instead.
async function* streamCursorSseChunks(iter, state, body) {
  const out = [];
  let buffer = null;
  let offset = 0;
  let stopReading = false;

  while (!stopReading) {
    while (buffer && offset < buffer.length) {
      const frame = readCursorFrame(buffer, offset, state.frameCount, " SSE");
      if (frame.status === "done") break; // incomplete frame — wait for more bytes
      offset = frame.offset;
      state.frameCount++;
      if (frame.status === "skip") continue;
      const { stop } = processCursorFrame(frame.payload, state, out);
      if (stop) { stopReading = true; break; }
    }

    if (out.length) {
      const joined = out.join("");
      out.length = 0;
      yield joined;
    }
    if (stopReading) break;

    const next = await iter.next();
    if (next.done) break;
    // Drop the consumed prefix, then append the new bytes.
    buffer = buffer ? Buffer.concat([buffer.slice(offset), next.value]) : next.value;
    offset = 0;
  }

  out.push(...finalizeCursorSse(state, body));
  if (out.length) yield out.join("");
}

async function readCursorStreamFully(byteStream) {
  const { iter, cancel } = toCursorAsyncIterable(byteStream);
  const parts = [];
  try {
    while (true) {
      const { done, value } = await iter.next();
      if (done) break;
      parts.push(value);
    }
  } catch (e) {
    await cancel().catch(() => {});
    throw e;
  }
  return Buffer.concat(parts);
}

function cursorFirstChunkWithTimeout(gen, cancel) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cancel?.().catch?.(() => {});
      reject(new Error("stream first chunk timeout"));
    }, STREAM_FIRST_CHUNK_TIMEOUT_MS);
    timer.unref?.();
    gen.next().then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

export default CursorExecutor;
