import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

vi.mock("@/lib/runtimePaths", () => ({
  accessRuntimePath: vi.fn(),
  getRuntimeHomeDir: vi.fn(() => "/mock/home"),
  joinRuntimePath: vi.fn((base, ...parts) => [base, ...parts].join("/")),
}));

const mockDbInstance = {
  prepare: vi.fn(),
  close: vi.fn(),
  __throwOnConstruct: false,
};

vi.mock("better-sqlite3", () => ({
  default: class MockDatabase {
    constructor() {
      if (mockDbInstance.__throwOnConstruct) throw new Error("SQLITE_CANTOPEN");
      return mockDbInstance;
    }
  },
}));

import { accessRuntimePath } from "../../src/lib/runtimePaths.js";
import { GET } from "../../src/app/api/oauth/cursor/auto-import/route.js";

function mockDatabaseValues(values) {
  mockDbInstance.prepare.mockReturnValue({
    get: vi.fn((key) => (values[key] ? { value: values[key] } : undefined)),
  });
}

describe("GET /api/oauth/cursor/auto-import", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbInstance.__throwOnConstruct = false;
    mockDatabaseValues({});
    Object.defineProperty(process, "platform", { value: "darwin", writable: true });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
  });

  it("reports all macOS locations when no Cursor database is accessible", async () => {
    vi.mocked(accessRuntimePath).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Cursor database not found. Checked locations:");
    expect(response.body.error).toContain("/mock/home/Library/Application Support/Cursor/User/globalStorage/state.vscdb");
    expect(response.body.error).toContain("Cursor - Insiders");
    expect(accessRuntimePath).toHaveBeenCalledTimes(2);
  });

  it("returns manual fallback when the detected database cannot be opened", async () => {
    vi.mocked(accessRuntimePath).mockResolvedValue();
    mockDbInstance.__throwOnConstruct = true;

    const response = await GET();

    expect(response.body).toEqual({
      found: false,
      windowsManual: true,
      dbPath: "/mock/home/Library/Application Support/Cursor/User/globalStorage/state.vscdb",
    });
  });

  it("extracts tokens using the preferred key names", async () => {
    vi.mocked(accessRuntimePath).mockResolvedValue();
    mockDatabaseValues({
      "cursorAuth/accessToken": "test-token",
      "storage.serviceMachineId": "test-machine-id",
    });

    const response = await GET();

    expect(response.body).toEqual({
      found: true,
      accessToken: "test-token",
      machineId: "test-machine-id",
    });
    expect(mockDbInstance.close).toHaveBeenCalledOnce();
  });

  it("unwraps JSON-encoded token values", async () => {
    vi.mocked(accessRuntimePath).mockResolvedValue();
    mockDatabaseValues({
      "cursorAuth/accessToken": '"json-token"',
      "storage.serviceMachineId": '"json-machine-id"',
    });

    const response = await GET();

    expect(response.body).toEqual({
      found: true,
      accessToken: "json-token",
      machineId: "json-machine-id",
    });
  });

  it("uses supported alternate key names when preferred keys are absent", async () => {
    vi.mocked(accessRuntimePath).mockResolvedValue();
    mockDatabaseValues({
      "cursorAuth/token": "alternate-token",
      "storage.machineId": "alternate-machine-id",
    });

    const response = await GET();

    expect(response.body).toEqual({
      found: true,
      accessToken: "alternate-token",
      machineId: "alternate-machine-id",
    });
  });

  it("returns manual fallback when the database does not contain both tokens", async () => {
    vi.mocked(accessRuntimePath).mockResolvedValue();
    mockDatabaseValues({ "cursorAuth/accessToken": "token-only" });

    const response = await GET();

    expect(response.body).toEqual({
      found: false,
      windowsManual: true,
      dbPath: "/mock/home/Library/Application Support/Cursor/User/globalStorage/state.vscdb",
    });
  });

  it("probes Linux locations before reporting a not-found result", async () => {
    Object.defineProperty(process, "platform", { value: "linux", writable: true });
    vi.mocked(accessRuntimePath).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("/mock/home/.config/Cursor/User/globalStorage/state.vscdb");
    expect(accessRuntimePath).toHaveBeenCalledTimes(2);
  });

  it("uses the portable fallback candidate paths for unrecognized platforms", async () => {
    Object.defineProperty(process, "platform", { value: "freebsd", writable: true });
    vi.mocked(accessRuntimePath).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("/mock/home/.config/cursor/User/globalStorage/state.vscdb");
  });
});
