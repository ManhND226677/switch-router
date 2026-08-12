const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init = {}) => ({
    body,
    status: init.status || 200,
    headers: init.headers || {},
  })),
  canAccessLocalDashboard: vi.fn(() => true),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: mocks.json,
  },
}));

vi.mock("@/dashboardGuard", () => ({
  canAccessLocalDashboard: mocks.canAccessLocalDashboard,
}));

const { POST: login } = await import("../../src/app/api/auth/login/route.js");
const { GET: authStatus } = await import("../../src/app/api/auth/status/route.js");
const { GET: oidcStart } = await import("../../src/app/api/auth/oidc/start/route.js");
const { GET: oidcCallback } = await import("../../src/app/api/auth/oidc/callback/route.js");
const { POST: oidcTest } = await import("../../src/app/api/auth/oidc/test/route.js");

describe("local-only dashboard authentication contract", () => {
  beforeEach(() => {
    mocks.json.mockClear();
    mocks.canAccessLocalDashboard.mockClear();
    mocks.canAccessLocalDashboard.mockReturnValue(true);
  });

  it("rejects legacy password login without reading or setting a session", async () => {
    const response = await login();

    expect(response.status).toBe(410);
    expect(response.body.dashboardAuthDisabled).toBe(true);
    expect(response.body.error).not.toContain("123456");
  });

  it("reports local-only access and never reports a password/OIDC session", async () => {
    const response = await authStatus({ headers: new Headers() });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      requireLogin: false,
      authMode: "local-only",
      dashboardAuthDisabled: true,
      localOnly: true,
      canAccessDashboard: true,
    });
    expect(response.body).not.toHaveProperty("hasPassword");
    expect(response.body).not.toHaveProperty("oidcConfigured");
  });

  it("disables OIDC start, callback and test without outbound work", async () => {
    for (const response of [await oidcStart(), await oidcCallback(), await oidcTest()]) {
      expect(response.status).toBe(410);
      expect(response.body.dashboardAuthDisabled).toBe(true);
      expect(response.body.error).toContain("disabled");
    }
  });
});
