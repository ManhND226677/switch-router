import { describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getCavotiUsage, normalizeCavotiUsage } from "../../open-sse/services/usage/cavoti.js";

describe("Cavoti usage", () => {
  it("normalizes balance and usage statistics without inventing percentages", () => {
    const usage = normalizeCavotiUsage({
      balance: "12.5",
      remaining: "8.2",
      planName: "Pro",
      mode: "token",
      daily: { requests: 3, tokens: 100, cost: 0.2 },
      total: { requests: 7, tokens: 300, cost: 0.5 },
    });

    expect(usage).toMatchObject({ plan: "Pro", mode: "token", balance: 12.5, remaining: 8.2 });
    expect(usage.quotas.balance).toMatchObject({ value: 12.5, unit: "USD", percentageAvailable: false });
    expect(usage.quotas.dailyRequests).toMatchObject({ value: 3, percentageAvailable: false });
    expect(usage.quotas.dailyRequests.remaining).toBeUndefined();
  });

  it("uses the selected Cavoti endpoint and does not leak credentials in errors", async () => {
    proxyAwareFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      balance: 2,
      planName: "Starter",
    }), { status: 200 }));

    const result = await getCavotiUsage("test-secret-key", { endpointProfile: "global" });

    expect(result).toMatchObject({ balance: 2, plan: "Starter" });
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      "https://cavoti.up.railway.app/v1/usage",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-secret-key" }) }),
      null,
    );
  });
});
