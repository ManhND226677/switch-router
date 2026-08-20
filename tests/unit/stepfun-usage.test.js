import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getStepFunUsage } from "../../open-sse/services/usage/misc.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { USAGE_SUPPORTED_PROVIDERS, USAGE_APIKEY_PROVIDERS } from "../../src/shared/constants/providers.js";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("StepFun usage / Quota Tracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is registered for Quota Tracker lists", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("stepfun");
    expect(USAGE_APIKEY_PROVIDERS).toContain("stepfun");
  });

  it("reads GET /v1/accounts into quotas", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          object: "account",
          type: "prepaid",
          balance: 12.5,
          total_cash_balance: 10,
          total_voucher_balance: 2.5,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: "step-3.7-flash" }, { id: "step-3.5-flash" }],
        }),
      });

    const usage = await getUsageForProvider({
      provider: "stepfun",
      apiKey: "sk-test",
      providerSpecificData: { apiMode: "token-plan" },
    });

    expect(usage.plan).toMatch(/token plan/i);
    expect(usage.meta.balance).toBe(12.5);
    expect(usage.meta.modelCount).toBe(2);
    expect(usage.quotas.balance.displayValue).toMatch(/12\.5|12,5/);
    expect(usage.message).toBeNull();
  });

  it("marks empty wallet when balances are zero", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          type: "prepaid",
          balance: 0,
          total_cash_balance: 0,
          total_voucher_balance: 0,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: "step-3.7-flash" }] }),
      });

    const usage = await getStepFunUsage("sk-test", { apiMode: "token-plan" });
    expect(usage.meta.walletEmpty).toBe(true);
    expect(usage.message).toMatch(/0|top up|token-plan/i);
  });

  it("parseQuotaData hides zero cash/voucher rows", () => {
    const rows = parseQuotaData("stepfun", {
      quotas: {
        balance: {
          used: 0,
          total: 5,
          remainingPercentage: 100,
          unit: "credits",
          displayValue: "5 remaining",
          displayTotal: "prepaid",
        },
        cash: { used: 0, total: 0, remainingPercentage: 0, unit: "credits", percentageAvailable: false },
        voucher: { used: 0, total: 0, remainingPercentage: 0, unit: "credits", percentageAvailable: false },
        models: {
          used: 0,
          total: 3,
          unlimited: true,
          percentageAvailable: false,
          displayValue: "3 models on plan",
        },
      },
      meta: { balance: 5, accountType: "prepaid" },
    });
    expect(rows.map((r) => r.name)).toEqual(["Balance", "Models"]);
  });
});
