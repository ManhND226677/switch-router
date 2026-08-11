import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  compressMessagesMock,
  dedupeToolsMock,
  executeMock,
  injectCavemanMock,
  injectPonytailMock,
  prefetchRemoteImagesMock,
  pxpipeMock,
  createRequestLoggerMock,
  stripUnsupportedModalitiesMock,
  translateRequestMock,
} = vi.hoisted(() => ({
  compressMessagesMock: vi.fn(() => null),
  dedupeToolsMock: vi.fn((tools) => ({ tools, stripped: [] })),
  executeMock: vi.fn(),
  injectCavemanMock: vi.fn(),
  injectPonytailMock: vi.fn(),
  prefetchRemoteImagesMock: vi.fn(async () => 0),
  pxpipeMock: vi.fn(async () => ({ body: null, summary: null })),
  createRequestLoggerMock: vi.fn(async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logError: vi.fn(),
  })),
  stripUnsupportedModalitiesMock: vi.fn(() => false),
  translateRequestMock: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({
    execute: executeMock,
    refreshCredentials: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock("../../open-sse/translator/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, translateRequest: translateRequestMock };
});

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: createRequestLoggerMock,
}));

vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: vi.fn(() => "claude"),
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

vi.mock("../../open-sse/rtk/index.js", () => ({
  compressMessages: compressMessagesMock,
  formatRtkLog: vi.fn(() => ""),
}));

vi.mock("../../open-sse/rtk/caveman.js", () => ({ injectCaveman: injectCavemanMock }));
vi.mock("../../open-sse/rtk/ponytail.js", () => ({ injectPonytail: injectPonytailMock }));
vi.mock("../../open-sse/rtk/pxpipe.js", () => ({ compressWithPxpipe: pxpipeMock }));

vi.mock("../../open-sse/utils/toolDeduper.js", () => ({ dedupeTools: dedupeToolsMock }));

vi.mock("../../open-sse/providers/capabilities.js", () => ({
  getCapabilitiesForModel: vi.fn(() => ({ vision: false, audioInput: false, pdf: false })),
}));

vi.mock("../../open-sse/translator/concerns/modality.js", () => ({
  stripUnsupportedModalities: stripUnsupportedModalitiesMock,
}));

vi.mock("../../open-sse/translator/concerns/prefetch.js", () => ({
  prefetchRemoteImages: prefetchRemoteImagesMock,
}));

vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", () => ({
  buildRequestDetail: vi.fn((detail) => detail),
  extractRequestConfig: vi.fn((body, stream) => ({ body, stream })),
}));

vi.mock("../../src/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../open-sse/utils/error.js", () => ({
  createErrorResult: vi.fn((status, message) => ({ success: false, status, error: message })),
  formatProviderError: vi.fn((error) => error.message),
  parseUpstreamError: vi.fn(),
}));

function makeOfficeLikeBody() {
  return {
    model: "claude-sonnet-5",
    stream: false,
    system: [{ type: "text", text: "Office-owned system context" }],
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "Read every text-bearing shape on the current slide." },
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: "AA==" } },
      ],
    }],
    tools: [{
      name: "run_office_script",
      description: "Run an Office.js script.",
      input_schema: { type: "object", properties: {} },
    }],
  };
}

describe("preserveClientPayload", () => {
  beforeEach(() => {
    compressMessagesMock.mockClear();
    dedupeToolsMock.mockClear();
    injectCavemanMock.mockClear();
    injectPonytailMock.mockClear();
    prefetchRemoteImagesMock.mockClear();
    pxpipeMock.mockClear();
    createRequestLoggerMock.mockClear();
    stripUnsupportedModalitiesMock.mockClear();
    translateRequestMock.mockClear();
    executeMock.mockReset();
    executeMock.mockRejectedValue(new Error("stop after dispatch"));
    translateRequestMock.mockImplementation((modelSource, modelTarget, model, body, stream) => ({
      model,
      messages: structuredClone(body.messages),
      tools: structuredClone(body.tools),
      stream,
    }));
  });

  it("skips all optional content transforms even if their global flags are enabled", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    const body = makeOfficeLikeBody();
    const original = structuredClone(body);

    const result = await handleChatCore({
      body,
      modelInfo: { provider: "openai-compatible-office-test", model: "office-model" },
      credentials: { apiKey: "test" },
      clientRawRequest: { endpoint: "/office/v1/messages", body, headers: { accept: "application/json" } },
      connectionId: "office-test-connection",
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), errorLine: vi.fn() },
      rtkEnabled: true,
      cavemanEnabled: true,
      cavemanLevel: "full",
      ponytailEnabled: true,
      ponytailLevel: "full",
      pxpipeEnabled: true,
      pxpipeTransform: pxpipeMock,
      providerThinking: { mode: "on" },
      sourceFormatOverride: "claude",
      preserveClientPayload: true,
    });

    expect(result.success).toBe(false);
    expect(body).toEqual(original);
    expect(translateRequestMock.mock.calls[0][8]).toEqual([]);
    expect(stripUnsupportedModalitiesMock).not.toHaveBeenCalled();
    expect(prefetchRemoteImagesMock).not.toHaveBeenCalled();
    expect(dedupeToolsMock).not.toHaveBeenCalled();
    expect(compressMessagesMock).not.toHaveBeenCalled();
    expect(injectCavemanMock).not.toHaveBeenCalled();
    expect(injectPonytailMock).not.toHaveBeenCalled();
    expect(pxpipeMock).not.toHaveBeenCalled();
    expect(createRequestLoggerMock.mock.calls[0]?.[3]).toEqual({ disableContent: true });
  });
});
