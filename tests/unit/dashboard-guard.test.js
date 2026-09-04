import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  nextResponse: Symbol("next"),
  jsonResponse: vi.fn((body, init) => ({
    status: init?.status || 200,
    body,
  })),
  validateApiKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    next: vi.fn(() => mocks.nextResponse),
    json: mocks.jsonResponse,
    redirect: vi.fn((url) => ({ status: 307, url })),
  },
}));

vi.mock("@/lib/localDb", () => ({
  validateApiKey: mocks.validateApiKey,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

const { proxy, __test__ } = await import("../../src/dashboardGuard.js");

function request(pathname, headers = {}) {
  const normalizedHeaders = new Headers(headers);
  return {
    nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
    headers: normalizedHeaders,
    cookies: { get: vi.fn(() => undefined) },
    url: `http://localhost${pathname}`,
  };
}

describe("dashboard guard public LLM API access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
  });

  it("allows loopback public LLM API without API key", async () => {
    const response = await proxy(request("/v1/chat/completions", { host: "localhost:28701" }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("rejects remote Host-spoof when real peer IP is non-loopback", async () => {
    const response = await proxy(request("/v1/chat/completions", {
      host: "localhost",
      "x-9r-real-ip": "10.204.111.34",
    }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for API access");
  });

  it("allows loopback peer IP regardless of Host", async () => {
    const response = await proxy(request("/v1/chat/completions", {
      host: "localhost:28701",
      "x-9r-real-ip": "127.0.0.1",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("rejects remote rewritten public LLM API without API key", async () => {
    // /api/v1* is no longer a public surface — remote callers hit the local-only wall.
    const response = await proxy(request("/api/v1/chat/completions", { host: "router.example.com" }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Switch-Router is local-only");
  });

  it("allows loopback rewritten public LLM API without API key", async () => {
    const response = await proxy(request("/api/v1/chat/completions", { host: "localhost:28701" }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("removed /v1beta surface falls through to Next (404), guarded nowhere", async () => {
    // Since 0.10.0 /v1beta is neither a public prefix nor an /api path:
    // middleware passes it through and Next itself answers 404 — remote and
    // loopback callers see the same dead end.
    const response = await proxy(request("/v1beta/models", { host: "router.example.com" }));

    expect(response).toBe(mocks.nextResponse);
  });

  it("rejects remote rewritten beta public LLM API without API key", async () => {
    // /api/v1beta is no longer public either — same local-only wall as /api/v1.
    const response = await proxy(request("/api/v1beta/models", { host: "router.example.com" }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Switch-Router is local-only");
  });

  it("removed /codex surface falls through to Next (404) for remote too", async () => {
    // Same as /v1beta: the rewrite is gone, Codex CLI must use /v1/responses.
    const response = await proxy(request("/codex/x", { host: "router.example.com" }));

    expect(response).toBe(mocks.nextResponse);
  });

  it("allows remote public LLM API with valid bearer API key", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/v1/chat/completions", {
      host: "router.example.com",
      authorization: "Bearer sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("allows remote public LLM API with valid x-api-key", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/v1/messages", {
      host: "router.example.com",
      "x-api-key": "sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("still accepts Google-style key headers on plain /v1 paths", async () => {
    // Gemini-native clients were migrated to /v1 in 0.10.0 — the Google key
    // extraction (x-goog-api-key / ?key=) must keep working there.
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/v1/models?key=sk-valid", {
      host: "router.example.com",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });
});

describe("dashboard guard local-only access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
  });

  it("rejects local-only route from non-loopback host without CLI token", async () => {
    const response = await proxy(request("/api/mcp/filesystem/sse", {
      host: "router.example.com",
    }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Local only: CLI token required");
  });

  it("allows local-only route on loopback without a JWT by default", async () => {
    const response = await proxy(request("/api/mcp/filesystem/sse", {
      host: "localhost:28701",
      origin: "http://localhost:28701",
    }));

    expect(response).toBe(mocks.nextResponse);
  });

  it("keeps local dashboard access without a login setting", async () => {
    const response = await proxy(request("/api/mcp/filesystem/sse", {
      host: "localhost:28701",
      origin: "http://localhost:28701",
    }));

    expect(response).toBe(mocks.nextResponse);
  });

  it("allows local-only route with valid CLI token", async () => {
    const response = await proxy(request("/api/mcp/filesystem/sse", {
      host: "router.example.com",
      "x-9r-cli-token": "cli-token",
    }));

    expect(response).toBe(mocks.nextResponse);
  });

  it("allows the local dashboard without a JWT", async () => {
    const response = await proxy(request("/dashboard", {
      host: "localhost:28701",
      origin: "http://localhost:28701",
    }));

    expect(response).toBe(mocks.nextResponse);
  });

  it("rejects remote dashboard requests without redirecting to login", async () => {
    const response = await proxy(request("/dashboard", {
      host: "router.example.com",
      "x-9r-real-ip": "10.0.0.8",
    }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Switch-Router dashboard is local-only");
  });

  it("falls through for legacy /login path (no redirect, no route)", async () => {
    const response = await proxy(request("/login", {
      host: "localhost:28701",
      origin: "http://localhost:28701",
    }));

    expect(response).toBe(mocks.nextResponse);
  });
});

describe("dashboard guard helpers", () => {
  it("recognizes IPv6 loopback requests", () => {
    const ipv6Request = request("/dashboard", {
      host: "[::1]:28701",
      origin: "http://[::1]:28701",
    });

    expect(__test__.isLocalRequest(ipv6Request)).toBe(true);
  });

  it("extracts bearer API keys before x-api-key", () => {
    const apiRequest = request("/v1/chat/completions", {
      authorization: "Bearer bearer-key",
      "x-api-key": "header-key",
    });

    expect(__test__.extractApiKey(apiRequest)).toBe("bearer-key");
  });

  it("extracts Google API keys after x-api-key", () => {
    const apiRequest = request("/v1/models?key=query-key", {
      "x-api-key": "header-key",
      "x-goog-api-key": "google-key",
    });

    expect(__test__.extractApiKey(apiRequest)).toBe("header-key");
  });
});
