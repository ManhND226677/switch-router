import { describe, it, expect, vi, beforeEach } from "vitest";

// A4 regression: MCP SSE sessions must be unregistered when the client drops
// abruptly (request.signal abort), not only on a clean ReadableStream cancel —
// otherwise the bridge keeps the session and the npx child process alive.
const mocks = vi.hoisted(() => ({
  registerSession: vi.fn(() => "sid-1"),
  unregisterSession: vi.fn(),
  findPlugin: vi.fn(() => ({ name: "cowork" })),
}));

vi.mock("@/lib/mcp/stdioSseBridge", () => ({
  registerSession: mocks.registerSession,
  unregisterSession: mocks.unregisterSession,
  findPlugin: mocks.findPlugin,
}));

vi.mock("next/server", () => ({}));

function makeRequest({ abort = false } = {}) {
  const controller = new AbortController();
  const request = { signal: controller.signal };
  request._abort = () => controller.abort(new Error("client dropped"));
  if (abort) request._abort();
  return request;
}

describe("MCP SSE session cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.registerSession.mockReturnValue("sid-1");
    mocks.findPlugin.mockReturnValue({ name: "cowork" });
  });

  it("registers a session and unregisters it on stream cancel", async () => {
    const { GET } = await import("../../src/app/api/mcp/[plugin]/sse/route.js");
    const request = makeRequest();
    const response = await GET(request, { params: { plugin: "cowork" } });

    expect(mocks.registerSession).toHaveBeenCalledWith("cowork", expect.any(Function));
    expect(mocks.unregisterSession).not.toHaveBeenCalled();

    // Cancelling the stream must clean the session up.
    await response.body.cancel();
    expect(mocks.unregisterSession).toHaveBeenCalledWith("cowork", "sid-1");
  });

  it("unregisters the session when the request aborts without a clean cancel", async () => {
    const { GET } = await import("../../src/app/api/mcp/[plugin]/sse/route.js");
    const request = makeRequest();
    const response = await GET(request, { params: { plugin: "cowork" } });

    expect(mocks.unregisterSession).not.toHaveBeenCalled();

    // Hard client drop: abort fires, stream.cancel never runs.
    request._abort();
    await new Promise((r) => setTimeout(r, 10));

    expect(mocks.unregisterSession).toHaveBeenCalledWith("cowork", "sid-1");

    // Never registered twice (cleanup is once-only).
    await response.body.cancel().catch(() => {});
    expect(mocks.unregisterSession).toHaveBeenCalledTimes(1);
  });

  it("returns 404 for unknown plugins without touching the bridge", async () => {
    mocks.findPlugin.mockReturnValue(null);
    const { GET } = await import("../../src/app/api/mcp/[plugin]/sse/route.js");
    const response = await GET(makeRequest(), { params: { plugin: "cowork" } });
    expect(response.status).toBe(404);
    expect(mocks.registerSession).not.toHaveBeenCalled();
  });
});
