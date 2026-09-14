// Reactive context guard: a provider-confirmed overflow must be trimmed and
// re-dispatched once to the SAME account, from inside handleChatCore.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, saveRequestDetailMock, createErrorResultMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  saveRequestDetailMock: vi.fn(() => Promise.resolve()),
  createErrorResultMock: vi.fn((status, message) => ({
    success: false,
    status,
    error: message,
    response: new Response(JSON.stringify({ error: { message } }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  })),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({
    execute: executeMock,
    refreshCredentials: vi.fn().mockResolvedValue(null),
  })),
}));

// Stub whose every string method is a spy — but never a thenable, or awaiting
// the logger would hang forever.
function loggerStub() {
  const impl = {};
  return new Proxy(impl, {
    get: (target, prop) => {
      if (typeof prop !== "string" || prop === "then" || prop === "catch" || prop === "finally") return undefined;
      if (!(prop in target)) target[prop] = vi.fn();
      return target[prop];
    },
  });
}

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: vi.fn(async () => loggerStub()),
}));

vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: vi.fn(() => null),
  isNativePassthrough: vi.fn(() => false),
}));

vi.mock("../../open-sse/utils/bypassHandler.js", () => ({
  handleBypassRequest: vi.fn(() => null),
}));

vi.mock("../../open-sse/utils/streamHandler.js", () => ({
  createStreamController: vi.fn(() => ({
    signal: undefined,
    handleComplete: vi.fn(),
    handleError: vi.fn(),
  })),
}));

vi.mock("../../open-sse/services/tokenRefresh.js", () => ({ refreshWithRetry: vi.fn() }));
vi.mock("../../open-sse/utils/toolDeduper.js", () => ({ dedupeTools: vi.fn(t => ({ tools: t, stripped: [] })) }));
vi.mock("../../open-sse/rtk/caveman.js", () => ({ injectCaveman: vi.fn() }));
vi.mock("../../open-sse/rtk/ponytail.js", () => ({ injectPonytail: vi.fn() }));
vi.mock("../../open-sse/rtk/index.js", () => ({ compressMessages: vi.fn(() => null), formatRtkLog: vi.fn(() => "") }));
vi.mock("../../open-sse/rtk/pxpipe.js", () => ({ compressWithPxpipe: vi.fn(async () => ({ summary: null })) }));
vi.mock("../../open-sse/translator/concerns/modality.js", () => ({ stripUnsupportedModalities: vi.fn(() => false) }));
vi.mock("../../open-sse/translator/concerns/prefetch.js", () => ({ prefetchRemoteImages: vi.fn(async () => 0) }));

// Real behaviour, no network: the guard depends on the body being consumed
// exactly once, so the parse must actually read the stream.
vi.mock("../../open-sse/utils/error.js", async () => {
  const actual = await vi.importActual("../../open-sse/utils/error.js");
  return {
    ...actual,
    parseUpstreamError: vi.fn(async response => ({ statusCode: response.status, message: await response.text() })),
    createErrorResult: (status, message, resetsAtMs) => createErrorResultMock(status, message, resetsAtMs),
  };
});

vi.mock("../../src/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: saveRequestDetailMock,
  saveRequestUsage: vi.fn(),
}));

const { OVERFLOW_BODY } = vi.hoisted(() => ({
  // The exact triple-encoded payload StepFun returned on 2026-08-27.
  OVERFLOW_BODY: JSON.stringify({
    error: {
      message: JSON.stringify({ detail: JSON.stringify({
        stage: "prefill",
        message: {
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "This model's maximum context length is 262144 tokens. However, you requested 0 output tokens and your prompt contains at least 262145 input tokens, for a total of at least 262145 tokens. Please reduce the length of the input prompt or the number of requested output tokens. (parameter=input_tokens, value=262145)",
          },
        },
      }) }),
      type: "input_invalid",
    },
  }),
}));

const fill = (n, ch = "x") => ch.repeat(n);

function makeBody() {
  return {
    model: "stepfun/step-3.7-flash",
    max_tokens: 4096,
    messages: [
      { role: "system", content: fill(300) },
      { role: "user", content: fill(60000) },
      { role: "assistant", content: fill(60000) },
      { role: "user", content: fill(60000) },
      { role: "assistant", content: fill(60000) },
      { role: "user", content: "summarise the above" },
    ],
  };
}

function makeOptions(overrides = {}) {
  const body = makeBody();
  return {
    body,
    modelInfo: { provider: "stepfun", model: "step-3.7-flash" },
    credentials: { apiKey: "sk-test", connectionId: "conn-1", connectionName: "primary" },
    clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: { accept: "application/json" } },
    connectionId: "conn-1",
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), line: vi.fn() },
    contextGuardEnabled: true,
    contextAutoTrimEnabled: true,
    ...overrides,
  };
}

const okResponse = () => new Response(JSON.stringify({
  id: "chatcmpl-1", object: "chat.completion", created: 1, model: "step-3.7-flash",
  choices: [{ index: 0, message: { role: "assistant", content: "short answer" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 100, completion_tokens: 5 },
}), { status: 200, headers: { "content-type": "application/json" } });

const overflowResponse = () => new Response(OVERFLOW_BODY, {
  status: 400,
  headers: { "content-type": "application/json" },
});

describe("handleChatCore context guard", () => {
  beforeEach(() => {
    executeMock.mockReset();
    saveRequestDetailMock.mockClear();
    createErrorResultMock.mockClear();
  });

  it("trims once and re-dispatches to the same account on a confirmed overflow", async () => {
    // The trimmer mutates the body in place, so the payload has to be
    // measured at dispatch time rather than at assertion time.
    const dispatched = [];
    const measure = async ({ body, credentials }) => {
      dispatched.push({ size: JSON.stringify(body).length, credentials });
    };
    executeMock
      .mockImplementationOnce(async (args) => {
        await measure(args);
        return { response: overflowResponse(), url: "https://upstream/v1/chat/completions", headers: {}, transformedBody: args.body };
      })
      .mockImplementationOnce(async (args) => {
        await measure(args);
        return { response: okResponse(), url: "https://upstream/v1/chat/completions", headers: {}, transformedBody: args.body };
      });

    const result = await handleChatCoreCall();

    expect(executeMock).toHaveBeenCalledTimes(2);
    // Same credentials object, so no new account fan-out is possible.
    expect(dispatched[1].credentials).toBe(dispatched[0].credentials);
    expect(dispatched[1].size).toBeLessThan(dispatched[0].size);
    expect(result.success).toBe(true);
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get("x-switch-router-context-trim")).toMatch(/^applied; dropped=\d+; before=\d+; after=\d+; budget=\d+$/);
    expect(result.response.headers.get("Access-Control-Expose-Headers")).toContain("x-switch-router-context-trim");
  });

  it("records what it dropped on the success row", async () => {
    executeMock
      .mockResolvedValueOnce({ response: overflowResponse(), url: "u", headers: {}, transformedBody: makeBody() })
      .mockResolvedValueOnce({ response: okResponse(), url: "u", headers: {}, transformedBody: makeBody() });

    await handleChatCoreCall();

    const guard = savedDetails().map(d => d.contextGuard).find(Boolean);
    expect(guard).toMatchObject({ overflow: true, trimmed: true, recovered: true });
    expect(guard.dropped).toBeGreaterThan(0);
    expect(guard.max).toBe(262144);
  });

  it("logs the trim on the correlated request line", async () => {
    const options = makeOptions();
    executeMock
      .mockResolvedValueOnce({ response: overflowResponse(), url: "u", headers: {}, transformedBody: makeBody() })
      .mockResolvedValueOnce({ response: okResponse(), url: "u", headers: {}, transformedBody: makeBody() });

    await (await import("../../open-sse/handlers/chatCore.js")).handleChatCore(options);

    const line = options.log.line.mock.calls.map(c => c.join(" ")).find(l => l.includes("CTXGUARD"));
    expect(line).toContain("retried stepfun/step-3.7-flash OK");
  });

  it("does not touch the payload when auto-trim is off, but still records the overflow", async () => {
    executeMock.mockResolvedValue({ response: overflowResponse(), url: "u", headers: {}, transformedBody: makeBody() });

    const result = await handleChatCoreCall({ contextAutoTrimEnabled: false });

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    // The message must be the one parsed from the consumed body, not a re-read.
    expect(result.error).toContain("maximum context length is 262144 tokens");
    const guard = savedDetails().map(d => d.contextGuard).find(Boolean);
    expect(guard).toMatchObject({ overflow: true, trimmed: false, reason: "auto-trim-disabled" });
    expect(result.response.headers.get("x-switch-router-context-trim")).toBe("refused; reason=auto-trim-disabled");
  });

  it("never parses or trims when the client opts out by header", async () => {
    const options = makeOptions();
    options.clientRawRequest.headers["x-switch-router-context-trim"] = "off";
    executeMock.mockResolvedValue({ response: overflowResponse(), url: "u", headers: {}, transformedBody: makeBody() });

    const result = await (await import("../../open-sse/handlers/chatCore.js")).handleChatCore(options);

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(savedDetails().every(d => d.contextGuard === undefined)).toBe(true);
  });

  it("leaves an ordinary 400 exactly as it was", async () => {
    executeMock.mockResolvedValue({
      response: new Response(JSON.stringify({ error: { message: "messages.0: expected string" } }), { status: 400, headers: { "content-type": "application/json" } }),
      url: "u", headers: {}, transformedBody: makeBody(),
    });

    const result = await handleChatCoreCall();

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(400);
    expect(result.response.headers.has("x-switch-router-context-trim")).toBe(false);
    expect(result.response.headers.has("Access-Control-Expose-Headers")).toBe(false);
    expect(savedDetails().every(d => d.contextGuard === undefined)).toBe(true);
  });

  it("keeps the original overflow visible when the trimmed retry still fails", async () => {
    executeMock
      .mockResolvedValueOnce({ response: overflowResponse(), url: "u", headers: {}, transformedBody: makeBody() })
      .mockResolvedValueOnce({ response: overflowResponse(), url: "u", headers: {}, transformedBody: makeBody() });

    const result = await handleChatCoreCall();

    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(false);
    const guard = savedDetails().map(d => d.contextGuard).find(Boolean);
    expect(guard).toMatchObject({ trimmed: true, recovered: false, reason: "retry-failed" });
    expect(guard.overflowMessage).toContain("maximum context length");
  });

  it("refuses to trim when it cannot trust any window figure", async () => {
    executeMock.mockResolvedValue({
      response: new Response(JSON.stringify({ error: { message: "prompt is too long" } }), { status: 400, headers: { "content-type": "application/json" } }),
      url: "u", headers: {}, transformedBody: makeBody(),
    });

    const result = await handleChatCoreCall({ modelInfo: { provider: "custom-proxy", model: "brand-new-model-xyz" } });

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(400);
    const guard = savedDetails().map(d => d.contextGuard).find(Boolean);
    expect(guard).toMatchObject({ overflow: true, trimmed: false, reason: "no-reliable-window" });
  });
});

async function handleChatCoreCall(overrides = {}) {
  const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
  return handleChatCore(makeOptions(overrides));
}

function savedDetails() {
  return saveRequestDetailMock.mock.calls.map(call => call[0]);
}
