import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/app/api/usage/[connectionId]/route.js", () => ({
  refreshAndUpdateCredentials: vi.fn(),
}));

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock("open-sse/executors/workbuddy.js", () => ({
  resolveWorkbuddySession: vi.fn(),
}));

import { runWorkbuddyAutoCheckinTick, ensureWorkbuddyAutoCheckinStarted } from "../../src/shared/services/workbuddyAutoCheckin.js";
import { getProviderConnections } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "@/app/api/usage/[connectionId]/route.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { resolveWorkbuddySession } from "open-sse/executors/workbuddy.js";

// Live-shape responses captured 2026-09-12 from www.workbuddy.ai (see the
// scheduler module header for the wire contract).
function jsonOk(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => ({ code: 0, msg: "OK", data }) };
}
function jsonError(code, msg, status = 400) {
  return { ok: false, status, json: async () => ({ code, msg, data: null }) };
}
const seasonActive = (extra = {}) => ({
  active: true, today_checked_in: false, streak_days: 2, daily_credit: 20,
  start_time: "2026-09-01 00:00:00", end_time: "2026-10-01 00:00:00", ...extra,
});
const seasonIdle = { active: false, today_checked_in: false, streak_days: 0, daily_credit: 0, start_time: "", end_time: "" };

const conn = (over = {}) => ({
  id: "conn-1", provider: "workbuddy", email: "user@example.com", isActive: 1,
  accessToken: "token", apiKey: null, providerSpecificData: {}, ...over,
});
const freshState = () => ({ interval: null, firstTickTimer: null, running: false, connections: {} });

describe("workbuddy auto check-in scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveConnectionProxyConfig.mockResolvedValue({ connectionProxyEnabled: false });
    resolveWorkbuddySession.mockImplementation((c) => (c.accessToken ? { accessToken: c.accessToken } : null));
  });

  it("claims the day's credits when a season is live and not yet checked in", async () => {
    getProviderConnections.mockResolvedValue([conn()]);
    proxyAwareFetch
      .mockResolvedValueOnce(jsonOk(seasonActive()))
      .mockResolvedValueOnce(jsonOk({ credit: 20, streak_days: 3, is_streak_day: true }));

    const state = await runWorkbuddyAutoCheckinTick(undefined, freshState());

    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    const [statusUrl, statusInit] = proxyAwareFetch.mock.calls[0];
    const [claimUrl] = proxyAwareFetch.mock.calls[1];
    expect(statusUrl).toBe("https://www.workbuddy.ai/billing/meter/checkin-status");
    expect(statusInit.method).toBe("POST");
    expect(claimUrl).toBe("https://www.workbuddy.ai/billing/meter/daily-checkin");
    expect(state.connections["conn-1"]).toMatchObject({
      status: "claimed",
      todayCheckedIn: true,
      seasonActive: true,
      lastClaimCredit: 20,
      needClaim: false,
      lastError: null,
    });
  });

  it("skips the claim when today is already checked in", async () => {
    getProviderConnections.mockResolvedValue([conn()]);
    proxyAwareFetch.mockResolvedValueOnce(jsonOk(seasonActive({ today_checked_in: true, streak_days: 5 })));

    const state = await runWorkbuddyAutoCheckinTick(undefined, freshState());

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(state.connections["conn-1"]).toMatchObject({ status: "checked_in", todayCheckedIn: true, needClaim: false });
  });

  it("stays idle (no claim, throttled status reads) while no season is running", async () => {
    getProviderConnections.mockResolvedValue([conn()]);
    proxyAwareFetch.mockResolvedValue(jsonOk(seasonIdle));

    const state = await runWorkbuddyAutoCheckinTick(undefined, freshState());

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(state.connections["conn-1"]).toMatchObject({ status: "inactive", seasonActive: false, needClaim: false });

    // The idle throttle: an immediate second tick must not re-read the status.
    const state2 = await runWorkbuddyAutoCheckinTick(undefined, state);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(state2.connections["conn-1"].status).toBe("inactive");
  });

  it("keeps retrying a rejected claim on the next tick instead of idling out", async () => {
    getProviderConnections.mockResolvedValue([conn()]);
    proxyAwareFetch
      .mockResolvedValueOnce(jsonOk(seasonActive()))
      .mockResolvedValueOnce(jsonError(10001, "签到活动未开启或已过期"))
      .mockResolvedValueOnce(jsonOk(seasonActive()))
      .mockResolvedValueOnce(jsonOk({ credit: 20, streak_days: 3, is_streak_day: true }));

    const failed = await runWorkbuddyAutoCheckinTick(undefined, freshState());
    expect(failed.connections["conn-1"]).toMatchObject({
      status: "claim_failed",
      needClaim: true,
      lastClaimResult: { code: 10001 },
    });

    const retried = await runWorkbuddyAutoCheckinTick(undefined, failed);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(4);
    expect(retried.connections["conn-1"]).toMatchObject({ status: "claimed", lastClaimCredit: 20 });
  });

  it("refreshes the session once and retries when the status read comes back 401", async () => {
    getProviderConnections.mockResolvedValue([conn()]);
    refreshAndUpdateCredentials.mockResolvedValue({ connection: conn({ accessToken: "fresh-token" }) });
    proxyAwareFetch
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ code: 401, msg: "invalid_token" }) })
      .mockResolvedValueOnce(jsonOk(seasonActive()))
      .mockResolvedValueOnce(jsonOk({ credit: 20, streak_days: 3, is_streak_day: true }));

    const state = await runWorkbuddyAutoCheckinTick(undefined, freshState());

    expect(refreshAndUpdateCredentials).toHaveBeenCalledTimes(1);
    // Retry used the refreshed token.
    const retryInit = proxyAwareFetch.mock.calls[1][1];
    expect(retryInit.headers.Authorization).toBe("Bearer fresh-token");
    expect(state.connections["conn-1"].status).toBe("claimed");
  });

  it("marks connections without a resolvable session and never calls upstream", async () => {
    getProviderConnections.mockResolvedValue([conn({ accessToken: null })]);
    resolveWorkbuddySession.mockReturnValue(null);

    const state = await runWorkbuddyAutoCheckinTick(undefined, freshState());

    expect(proxyAwareFetch).not.toHaveBeenCalled();
    expect(state.connections["conn-1"]).toMatchObject({ status: "no_session", needClaim: false });
  });

  it("does not start timers under vitest (background jobs stay test-safe)", () => {
    expect(ensureWorkbuddyAutoCheckinStarted()).toBe(false);
  });
});
