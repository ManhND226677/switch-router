import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  createProviderConnection: vi.fn(),
}));

vi.mock("open-sse/executors/workbuddy.js", () => ({
  resolveWorkbuddySession: vi.fn(),
}));

import { getProviderConnections, updateProviderConnection, createProviderConnection } from "@/lib/localDb";
import { resolveWorkbuddySession } from "open-sse/executors/workbuddy.js";
import { GET, POST } from "../../src/app/api/oauth/workbuddy/[action]/route.js";

function jwtWithSub(sub) {
  const payload = Buffer.from(JSON.stringify({ sub })).toString("base64url");
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`;
}

const WB_STATE_URL = "https://www.workbuddy.ai/v2/plugin/auth/state?platform=workbuddy-ai";

// Existing "app session" connection for account A (as created by the fast path).
const connA = {
  id: "conn-a",
  provider: "workbuddy",
  authType: "oauth",
  name: "WorkBuddy AI (app session)",
  isActive: true,
  priority: 1,
  apiKey: "auto",
  providerSpecificData: { workbuddyUserId: "uid-a" },
};

function jsonResponse(body) {
  return { ok: true, json: async () => body };
}

function getRequest(search = "") {
  return { nextUrl: { searchParams: new URLSearchParams(search) } };
}

function ctx(action) {
  return { params: Promise.resolve({ action }) };
}

function mockUpstream({
  state = "wb-state",
  authUrl = "https://www.workbuddy.ai/login?state=wb-state",
  token = null,
  userinfo = { email: "user@test.dev", name: "Test User" },
  userinfoOk = true,
} = {}) {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (String(url).includes("/v2/plugin/auth/state")) {
      return jsonResponse({ code: 0, data: { state, authUrl } });
    }
    if (String(url).includes("/auth/realms/copilot/protocol/openid-connect/userinfo")) {
      return { ok: userinfoOk, json: async () => userinfo };
    }
    return jsonResponse({ code: 0, data: token });
  }));
}

describe("workbuddy oauth multi-account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    getProviderConnections.mockResolvedValue([connA]);
    createProviderConnection.mockImplementation(async (data) => ({ id: "conn-new", provider: "workbuddy", ...data }));
  });

  describe("GET device-code", () => {
    it("default mode takes the app-session fast path (no verification_uri, no upstream call)", async () => {
      vi.mocked(resolveWorkbuddySession).mockReturnValue({ accessToken: "tok", uid: "uid-a" });
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const res = await GET(getRequest(), ctx("device-code"));

      expect(res.body.verification_uri).toBeUndefined();
      expect(res.body.interval).toBe(1);
      expect(res.body.device_code).toEqual(expect.any(String));
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("mode=web skips the app-session fast path and returns the web login URL", async () => {
      vi.mocked(resolveWorkbuddySession).mockReturnValue({ accessToken: "tok", uid: "uid-a" });
      mockUpstream();

      const res = await GET(getRequest("mode=web"), ctx("device-code"));

      expect(res.body.verification_uri).toBe("https://www.workbuddy.ai/login?state=wb-state");
      expect(res.body.device_code).toBe("wb-state");
    });

    it("falls back to the web flow when no local app session exists", async () => {
      vi.mocked(resolveWorkbuddySession).mockReturnValue(null);
      mockUpstream();

      const res = await GET(getRequest(), ctx("device-code"));

      expect(res.body.verification_uri).toBe("https://www.workbuddy.ai/login?state=wb-state");
    });
  });

  describe("POST poll", () => {
    it("app flow imports the desktop session and updates the same-uid connection", async () => {
      vi.mocked(resolveWorkbuddySession).mockReturnValue({ accessToken: "tok", uid: "uid-a" });
      mockUpstream();
      const getRes = await GET(getRequest(), ctx("device-code"));
      const deviceCode = getRes.body.device_code;

      const res = await POST({ json: async () => ({ deviceCode }) }, ctx("poll"));

      expect(res.body.success).toBe(true);
      expect(res.body.connection.id).toBe("conn-a");
      expect(updateProviderConnection).toHaveBeenCalledWith("conn-a", expect.objectContaining({
        apiKey: "auto",
        testStatus: "active",
        // Generic "(app session)" name is upgraded to the account identity.
        name: "WorkBuddy AI (user@test.dev)",
        email: "user@test.dev",
      }));
      expect(createProviderConnection).not.toHaveBeenCalled();
    });

    it("web flow ignores the desktop session and creates a second connection for the new uid", async () => {
      // Local app session (account A) still present while account B logs in on the web.
      vi.mocked(resolveWorkbuddySession).mockReturnValue({ accessToken: "tok", uid: "uid-a" });
      mockUpstream({ token: { accessToken: jwtWithSub("uid-b"), refreshToken: "rt-b", expiresIn: 3600, nickname: "B" } });

      const getRes = await GET(getRequest("mode=web"), ctx("device-code"));
      const res = await POST({ json: async () => ({ deviceCode: getRes.body.device_code }) }, ctx("poll"));

      expect(res.body.success).toBe(true);
      expect(res.body.connection.id).toBe("conn-new");
      expect(createProviderConnection).toHaveBeenCalledWith(expect.objectContaining({
        provider: "workbuddy",
        authType: "oauth",
        name: "WorkBuddy AI (user@test.dev)",
        email: "user@test.dev",
        accessToken: jwtWithSub("uid-b"),
        refreshToken: "rt-b",
        providerSpecificData: { workbuddyUserId: "uid-b" },
        isActive: true,
      }));
      expect(updateProviderConnection).not.toHaveBeenCalled();
    });

    it("web flow for an already-known uid refreshes the existing connection instead of duplicating it", async () => {
      vi.mocked(resolveWorkbuddySession).mockReturnValue({ accessToken: "tok", uid: "uid-a" });
      mockUpstream({ token: { accessToken: jwtWithSub("uid-a"), refreshToken: "rt-a", expiresIn: 3600 } });

      const getRes = await GET(getRequest("mode=web"), ctx("device-code"));
      const res = await POST({ json: async () => ({ deviceCode: getRes.body.device_code }) }, ctx("poll"));

      expect(res.body.success).toBe(true);
      expect(res.body.connection.id).toBe("conn-a");
      expect(updateProviderConnection).toHaveBeenCalledWith("conn-a", expect.objectContaining({
        accessToken: jwtWithSub("uid-a"),
        refreshToken: "rt-a",
        apiKey: null,
        testStatus: "active",
      }));
      expect(createProviderConnection).not.toHaveBeenCalled();
    });

    it("names the connection after the account email/name, falling back to the token nickname", async () => {
      vi.mocked(resolveWorkbuddySession).mockReturnValue(null);
      mockUpstream({
        token: { accessToken: jwtWithSub("uid-c"), refreshToken: "rt-c", expiresIn: 3600, nickname: "Bee" },
        userinfoOk: false,
      });

      const getRes = await GET(getRequest("mode=web"), ctx("device-code"));
      await POST({ json: async () => ({ deviceCode: getRes.body.device_code }) }, ctx("poll"));

      expect(createProviderConnection).toHaveBeenCalledWith(expect.objectContaining({
        name: "WorkBuddy AI (Bee)",
      }));
      const created = createProviderConnection.mock.calls[0][0];
      expect(created.email).toBeUndefined();
    });

    it("keeps a user-custom connection name on re-login", async () => {
      getProviderConnections.mockResolvedValue([{ ...connA, name: "My custom WB" }]);
      vi.mocked(resolveWorkbuddySession).mockReturnValue({ accessToken: "tok", uid: "uid-a" });
      const getRes = await GET(getRequest(), ctx("device-code"));

      await POST({ json: async () => ({ deviceCode: getRes.body.device_code }) }, ctx("poll"));

      const updateArg = updateProviderConnection.mock.calls[0][1];
      expect(updateArg.name).toBeUndefined();
    });

    it("web flow still reports pending until the browser login is bound", async () => {
      vi.mocked(resolveWorkbuddySession).mockReturnValue(null);
      mockUpstream({ token: null });

      const getRes = await GET(getRequest("mode=web"), ctx("device-code"));
      const res = await POST({ json: async () => ({ deviceCode: getRes.body.device_code }) }, ctx("poll"));

      expect(res.body).toEqual(expect.objectContaining({ success: false, error: "authorization_pending", pending: true }));
      expect(createProviderConnection).not.toHaveBeenCalled();
      expect(updateProviderConnection).not.toHaveBeenCalled();
    });
  });
});
