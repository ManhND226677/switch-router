import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getVilaoUsage } from "../../open-sse/services/usage/misc.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { USAGE_SUPPORTED_PROVIDERS, USAGE_APIKEY_PROVIDERS } from "../../src/shared/constants/providers.js";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("ViLao usage / Quota Tracker (pay-as-you-go balance)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is registered for Quota Tracker lists", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("vilao");
    expect(USAGE_APIKEY_PROVIDERS).toContain("vilao");
  });

  it("reads GET /v1/usage/balance into a clean 3-row shape", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "healthy" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ region: "vi", cny_to_vnd_rate: 3850 }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          balance: 62193.96,
          total_requests: 4176,
          total_tokens: 0,
          total_spent: 9659,
          success_rate: 95.19,
          models: ["xai/grok-4.6", "gpt-5.3-codex-spark"],
          last_request: { model_id: "grok-4.5", total_cost: 1 },
        }),
      });

    const usage = await getUsageForProvider({
      provider: "vilao",
      apiKey: "sk-test",
      providerSpecificData: {},
    });

    // Healthy wallet: no blocking message (table must render)
    expect(usage.message).toBeNull();
    expect(usage.meta.balance).toBeCloseTo(62193.96, 1);
    expect(usage.meta.currency).toBe("VND");
    expect(usage.quotas.balance.displayValue).toMatch(/còn lại/);
    expect(usage.quotas.balance.displayTotal).toMatch(/đã tiêu/);
    expect(usage.quotas.requests.percentageAvailable).toBe(false);
    expect(usage.quotas.models.displayValue).toMatch(/2 model/);
    // Only one money row
    expect(usage.quotas.credit_remaining).toBeUndefined();
  });

  it("maps HTTP 402 on balance to empty wallet message", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "healthy" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ region: "vi" }) })
      .mockResolvedValueOnce({ ok: false, status: 402, json: async () => ({}) });

    const usage = await getVilaoUsage("sk-test", {});
    expect(usage.meta.walletEmpty).toBe(true);
    expect(usage.quotas.balance.remainingPercentage).toBe(0);
    expect(usage.message).toMatch(/hết tiền|empty|402/i);
  });

  it("parseQuotaData keeps one money row with displayValue", () => {
    const rows = parseQuotaData("vilao", {
      quotas: {
        balance: {
          used: 1000,
          total: 5000,
          remainingPercentage: 80,
          unit: "VND",
          displayValue: "4,000₫ còn lại",
          displayTotal: "đã tiêu 1,000₫",
        },
        requests: {
          used: 100,
          total: 100,
          percentageAvailable: false,
          unlimited: true,
          unit: "requests",
          displayValue: "100 requests · 95% ok",
        },
        models: {
          used: 0,
          total: 4,
          percentageAvailable: false,
          unlimited: true,
          unit: "models",
          displayValue: "4 model đã subscribe",
        },
      },
      meta: { walletEmpty: false, balance: 4000, totalSpent: 1000, currency: "VND" },
    });
    // Row names are i18n keys (vi.json maps "Balance" → "Số dư" at render time)
    expect(rows.map((r) => r.name)).toEqual(["Balance", "Requests", "Models"]);
    expect(rows[0].displayValue).toMatch(/còn lại/);
    expect(rows[0].remainingPercentage).toBe(80);
    expect(rows[1].percentageAvailable).toBe(false);
  });
});
