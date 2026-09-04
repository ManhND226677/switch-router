import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================
// A1 — requestLogger must redact credential-bearing headers
// (x-9r-cli-token, x-switch-router-internal-secret) before they
// are persisted to logs/ by ENABLE_REQUEST_LOGS sessions.
// ============================================================
const { __test__ } = await import("../../open-sse/utils/requestLogger.js");

const { maskSensitiveHeaders } = __test__;

describe("requestLogger maskSensitiveHeaders", () => {
  it("redacts the CLI token header by substring match", () => {
    const masked = maskSensitiveHeaders({ "x-9r-cli-token": "super-secret-token" });
    expect(masked["x-9r-cli-token"]).toBe("[REDACTED]");
  });

  it("redacts the internal secret header by substring match", () => {
    const masked = maskSensitiveHeaders({ "x-switch-router-internal-secret": "abc" });
    expect(masked["x-switch-router-internal-secret"]).toBe("[REDACTED]");
  });

  it("still redacts classic credential headers", () => {
    const masked = maskSensitiveHeaders({
      authorization: "Bearer x",
      "proxy-authorization": "Basic y",
      "x-api-key": "k",
      cookie: "session=1",
      "set-cookie": "a=b",
    });
    for (const name of ["authorization", "proxy-authorization", "x-api-key", "cookie", "set-cookie"]) {
      expect(masked[name]).toBe("[REDACTED]");
    }
  });

  it("leaves benign headers untouched", () => {
    const headers = {
      "content-type": "application/json",
      "x-request-id": "req-123",
      "user-agent": "switch-router-cli/1.0",
    };
    expect(maskSensitiveHeaders(headers)).toEqual(headers);
  });

  it("handles null/undefined input", () => {
    expect(maskSensitiveHeaders(null)).toEqual({});
    expect(maskSensitiveHeaders(undefined)).toEqual({});
  });
});

// ============================================================
// A2 — GET /api/settings/database must value-compare the CLI
// token (header presence alone is not auth: clients can set any
// header). Non-local request + wrong token => 403.
// ============================================================
const mocks = vi.hoisted(() => ({
  nextResponse: Symbol("next"),
  jsonResponse: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  exportDb: vi.fn(),
  importDb: vi.fn(),
  getSettings: vi.fn(),
  applyOutboundProxyEnv: vi.fn(),
  getConsistentMachineId: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    next: vi.fn(() => mocks.nextResponse),
    json: mocks.jsonResponse,
  },
}));

vi.mock("@/lib/localDb", () => ({
  exportDb: mocks.exportDb,
  importDb: mocks.importDb,
  getSettings: mocks.getSettings,
}));

vi.mock("@/lib/network/outboundProxy", () => ({
  applyOutboundProxyEnv: mocks.applyOutboundProxyEnv,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

function request(headers = {}) {
  return {
    nextUrl: { pathname: "/api/settings/database" },
    headers: new Headers(headers),
    url: "http://localhost:28701/api/settings/database",
    json: async () => ({}),
  };
}

describe("settings/database route CLI token gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.NODE_ENV = "production";
    mocks.getConsistentMachineId.mockResolvedValue("real-machine-token");
  });

  it("rejects a client-supplied CLI token header with a wrong value (403)", async () => {
    const { GET } = await import("../../src/app/api/settings/database/route.js");
    const response = await GET(request({ "x-9r-cli-token": "forged-value" }));
    expect(response.status).toBe(403);
    expect(mocks.exportDb).not.toHaveBeenCalled();
  });

  it("rejects any header presence when value differs from machine token", async () => {
    const { GET } = await import("../../src/app/api/settings/database/route.js");
    const response = await GET(request({ "x-9r-cli-token": "1" }));
    expect(response.status).toBe(403);
    expect(mocks.exportDb).not.toHaveBeenCalled();
  });

  it("accepts a request with the correct machine token", async () => {
    mocks.exportDb.mockResolvedValue({ connections: [], apiKeys: [] });
    const { GET } = await import("../../src/app/api/settings/database/route.js");
    const response = await GET(request({ "x-9r-cli-token": "real-machine-token" }));
    expect(response.status).toBe(200);
    expect(mocks.exportDb).toHaveBeenCalledTimes(1);
  });
});
