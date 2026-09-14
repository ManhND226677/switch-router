import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock("../../src/lib/db/repos/usageRepo.js", () => ({
  getObservedUsageForConnection: vi.fn(async () => ({
    scope: "local",
    period: "all",
    requests: 2,
    promptTokens: 120,
    completionTokens: 80,
    cachedTokens: 20,
    lastUsed: "2026-09-11T04:00:00.000Z",
    costUsd: null,
    pricingStatus: "not_applicable",
  })),
}));

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import { getPricingForModel, calculateCostFromTokens } from "../../open-sse/providers/pricing.js";
import { parseWorkbuddyCatalog, resolveNovitaModels, resolveWorkbuddyModels, clearProviderModelCatalogCache } from "../../open-sse/services/providerModels.js";
import { filterWorkbuddyModels } from "../../open-sse/providers/workbuddyCatalog.js";
import { getWorkbuddyUsage } from "../../open-sse/services/usage/workbuddy.js";
import { getNovitaUsage, parseBalanceResponse, parseNovitaQuotaList } from "../../open-sse/services/usage/novita.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { USAGE_SUPPORTED_PROVIDERS, USAGE_APIKEY_PROVIDERS } from "../../src/shared/constants/providers.js";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("WorkBuddy and Novita provider registration", () => {
  it("keeps WorkBuddy legacy models, adds current fallback ids and native coefficients", () => {
    const provider = REGISTRY.find((entry) => entry.id === "workbuddy");
    const ids = new Set(provider.models.map((model) => model.id));
    for (const id of [
      "hy4-preview", "hy3", "glm-5.3", "glm-5.3-flash", "glm-5.2", "glm-5.1",
      "glm-5v-turbo", "minimax-m3", "minimax-m2.7", "kimi-k3", "kimi-k2.7-code",
      "kimi-k2.6", "deepseek-v4-flash", "deepseek-v4-pro", "deepseek-v4.1-flash", "default-model",
    ]) expect(ids).toContain(id);
    expect(provider.passthroughModels).toBe(true);
    expect(provider.features).toMatchObject({ usage: true, usageApikey: true });
    expect(provider.models.find((model) => model.id === "glm-5.2")).toMatchObject({
      creditMultiplier: 0.79,
      billingMode: "credits",
      catalogSource: "static",
    });
    expect(provider.models.find((model) => model.id === "hy3").billingMode).toBe("free_trial");
    expect(provider.models.find((model) => model.id === "deepseek-v4.1-flash")).toMatchObject({
      billingMode: "free_trial",
      isFree: true,
      supportsVision: true,
    });
  });

  it("registers Novita as a bearer API-key OpenAI-compatible provider", () => {
    const provider = REGISTRY.find((entry) => entry.id === "novita");
    expect(provider).toMatchObject({
      id: "novita",
      category: "apikey",
      alias: "novita",
      passthroughModels: true,
      features: { usage: true, usageApikey: true },
    });
    expect(PROVIDERS.novita).toMatchObject({
      baseUrl: "https://api.novita.ai/openai/v1/chat/completions",
      format: "openai",
      forceStream: false,
      validateUrl: "https://api.novita.ai/openai/v1/models",
    });
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("workbuddy");
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("novita");
    expect(USAGE_APIKEY_PROVIDERS).toContain("workbuddy");
    expect(USAGE_APIKEY_PROVIDERS).toContain("novita");
  });
});

describe("WorkBuddy catalog parser and resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearProviderModelCatalogCache();
  });

  it("normalizes missing names/capabilities and collapses identical duplicate ids", () => {
    const parsed = parseWorkbuddyCatalog({
      models: [
        { id: "model-new", context_length: 128000, reasoning: true },
        { id: "model-new", context_length: 128000, reasoning: true },
      ],
    });
    expect(parsed).toMatchObject({ valid: true });
    expect(parsed.models).toHaveLength(1);
    expect(parsed.models[0]).toMatchObject({
      id: "model-new",
      name: "model-new",
      contextLength: 128000,
      supportsReasoning: true,
      catalogSource: "live",
    });
  });

  it("uses the WorkBuddy agent allowlist and preserves free promo models", () => {
    const parsed = parseWorkbuddyCatalog({
      data: {
        models: [
          { id: "supported-paid", name: "Supported paid" },
          { id: "internal-only", name: "Internal only" },
        ],
        agents: [{ name: "craft", models: ["supported-paid", "free-promo"] }],
        modelPromotions: [{ id: "free-promo" }],
      },
    });
    expect(parsed).toMatchObject({ valid: true });
    expect(parsed.models.map((model) => model.id)).toEqual(["supported-paid", "free-promo"]);
    expect(parsed.models[1]).toMatchObject({ isFree: true, billingMode: "free_trial" });
    expect(filterWorkbuddyModels([
      { id: "supported-paid", catalogSource: "live" },
      { id: "unavailable-paid", catalogSource: "live", available: false },
      { id: "free-promo", catalogSource: "static", billingMode: "free_trial" },
      { id: "legacy", catalogSource: "static" },
    ]).map((model) => model.id)).toEqual(["supported-paid", "free-promo"]);
  });

  it("rejects conflicting duplicate upstream identities and invalid schema", () => {
    expect(parseWorkbuddyCatalog({ models: [
      { id: "same", upstreamModelId: "one" },
      { id: "same", upstreamModelId: "two" },
    ]})).toMatchObject({ valid: false, errorCode: "duplicate_conflict" });
    expect(parseWorkbuddyCatalog({ data: { unexpected: true } })).toMatchObject({
      valid: false,
      errorCode: "invalid_schema",
    });
  });

  it("fetches WorkBuddy config with bearer + X-User-Id and marks absent static models unavailable", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      models: [{ id: "glm-5.2", displayName: "GLM live", credit_multiplier: 0.81 }],
    }));
    const result = await resolveWorkbuddyModels({
      id: "wb-account-a",
      apiKey: "token",
      providerSpecificData: { workbuddyUserId: "uid/a" },
    });
    expect(result.catalogStatus).toBe("live");
    expect(result.models.find((model) => model.id === "glm-5.2")).toMatchObject({
      name: "GLM live",
      creditMultiplier: 0.81,
      available: true,
    });
    expect(result.models.find((model) => model.id === "default-model")).toBeUndefined();
    expect(result.models.find((model) => model.id === "deepseek-v4.1-flash")).toMatchObject({
      billingMode: "free_trial",
      isFree: true,
    });
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      "https://www.workbuddy.ai/v3/config",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer token",
          "X-User-Id": "uid%2Fa",
          "X-IDE-Type": "WorkBuddy",
          "X-IDE-Name": "WorkBuddy",
        }),
      }),
      null,
    );
  });

  it("falls back without retrying indefinitely when WorkBuddy catalog is unavailable", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({}, 403));
    const result = await resolveWorkbuddyModels({ id: "wb-account-b", apiKey: "token" });
    expect(result).toMatchObject({ catalogStatus: "fallback", errorCode: "http_403" });
    expect(result.models.map((model) => model.id)).toContain("deepseek-v4.1-flash");
    expect(result.models.map((model) => model.id)).not.toContain("gpt-5.6-sol");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });
});

describe("WorkBuddy native credits and observed usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes native credit packages from the billing-meter summary and computes rounded remaining percentage", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      data: {
        IsPaidUser: false,
        Packages: [{
          PackageCode: "TCACA_code_035_trial",
          CycleTotalCapacity: "1000",
          CycleUsedCapacity: "251",
          CycleFrozenCapacity: "0",
          CycleRemainCapacity: "749",
          CapacityUnit: "credits",
        }],
      },
    }));
    const usage = await getWorkbuddyUsage({
      connectionId: "wb-account-a",
      accessToken: "token",
    });

    // Endpoint pin: the desktop app's billing-meter summary, called with the
    // session token via POST (the old .cn openapi rejected this token class).
    const [url, init] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://www.workbuddy.ai/billing/meter/get-user-resource-summary");
    expect(init.method).toBe("POST");

    expect(usage.native).toMatchObject({
      status: "ok",
      totalCredits: 1000,
      usedCredits: 251,
      remainingCredits: 749,
      remainingPercentage: 75,
      source: "workbuddy-billing-meter",
    });
    expect(usage.observed).toMatchObject({ requests: 2, costUsd: null, pricingStatus: "not_applicable" });
    expect(parseQuotaData("workbuddy", usage).find((row) => row.name === "Native credits")).toMatchObject({
      used: 251,
      total: 1000,
      remainingPercentage: 75,
      unit: "credits",
    });
  });

  it("aggregates every credit package and rounds upstream float noise", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      data: {
        Packages: [
          { PackageCode: "gift", CycleTotalCapacity: "250", CycleUsedCapacity: "250", CycleRemainCapacity: "0", CapacityUnit: "credit" },
          { PackageCode: "activity", CycleTotalCapacity: "370", CycleUsedCapacity: "290.43999986", CycleRemainCapacity: "79.56000014", CapacityUnit: "credit" },
          { PackageCode: "trial", CycleTotalCapacity: "100", CycleUsedCapacity: "100", CycleRemainCapacity: "0", CapacityUnit: "credits" },
        ],
      },
    }));
    const usage = await getWorkbuddyUsage({
      connectionId: "wb-account-b",
      accessToken: "token",
    });

    expect(usage.native).toMatchObject({
      status: "ok",
      totalCredits: 720,
      usedCredits: 640.44,
      remainingCredits: 79.56,
    });
    expect(usage.native.remainingPercentage).toBe(11);
  });

  it("renders the Daily check-in scheduler row only after the scheduler has run", () => {
    const usage = {
      native: { status: "ok" },
      quotas: { credits: { used: 0, total: 100, remaining: 100, remainingPercentage: 100, percentageAvailable: true, unit: "credits" } },
    };
    expect(parseQuotaData("workbuddy", usage).find((row) => row.name === "Daily check-in")).toBeUndefined();

    usage.checkin = { status: "inactive", seasonActive: false, todayCheckedIn: false, streakDays: 0, dailyCredit: 0 };
    const idleRow = parseQuotaData("workbuddy", usage).find((row) => row.name === "Daily check-in");
    expect(idleRow).toMatchObject({ status: "inactive", percentageAvailable: false, used: null, total: null });
    expect(idleRow.message).toMatch(/No active check-in season/);

    usage.checkin = { status: "claimed", seasonActive: true, todayCheckedIn: true, streakDays: 3, dailyCredit: 20, lastClaimCredit: 20 };
    const activeRow = parseQuotaData("workbuddy", usage).find((row) => row.name === "Daily check-in");
    expect(activeRow).toMatchObject({
      status: "ok",
      displayValue: "Checked in today · streak 3",
      limitLabel: "Checked in",
      source: "workbuddy-billing-meter",
    });
  });

  it("reports permission_required rather than zero quota for 401/403", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ error: "missing scope" }, 403));
    const usage = await getWorkbuddyUsage({ connectionId: "wb-account-c", accessToken: "token" });
    expect(usage.native).toMatchObject({ status: "permission_required", totalCredits: null, usedCredits: null });
    expect(usage.message).toMatch(/permission|observed/i);
    const row = parseQuotaData("workbuddy", usage)[0];
    expect(row).toMatchObject({ percentageAvailable: false, status: "permission_required" });
    expect(row.used).toBeNull();
  });

  it("keeps native coefficients and unverified Novita models out of USD pricing", () => {
    expect(getPricingForModel("workbuddy", "deepseek-v4-flash")).toBeNull();
    expect(getPricingForModel("novita", "qwen/qwen-unknown")).toBeNull();
    expect(calculateCostFromTokens({ prompt_tokens: 100, cached_tokens: 100 }, {
      input: 1,
      cached: 0,
      output: 1,
    })).toBe(0);
    expect(calculateCostFromTokens({ prompt_tokens: 1000, completion_tokens: 1000 }, {
      input: 0.06,
      output: 0.16,
    })).toBeCloseTo(0.00022, 8);
  });
});

describe("Novita catalog, pricing, balance and rate limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearProviderModelCatalogCache();
  });

  it("keeps prefixed live IDs, deduplicates and attaches exact provider pricing", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      data: [
        { id: "qwen/qwen3.8-flash", name: "Qwen Flash" },
        { id: "qwen/qwen3.8-flash", name: "duplicate" },
        { id: "vendor/unknown-model", name: "Unknown" },
      ],
    }));
    const result = await resolveNovitaModels({ id: "novita-account-a", apiKey: "key" });
    expect(result.catalogStatus).toBe("live");
    expect(result.models.map((model) => model.id)).toEqual([
      "qwen/qwen3.8-flash",
      "vendor/unknown-model",
    ]);
    expect(result.models[0].pricing).toMatchObject({ input: 0.15, cached: 0.016, output: 0.47, currency: "USD" });
    expect(result.models[1]).toMatchObject({ pricingStatus: "unpriced", capabilityStatus: "missing" });
  });

  it("converts balance minor units and parses RPM/TPM without fake usage counters", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({
        availableBalance: "10000",
        cashBalance: "8000",
        creditLimit: "20000",
        pendingCharges: "100",
        outstandingInvoices: "0",
      }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ quotaObject: "deepseek-v3", quotaType: "RPM", currentQuota: 60, defaultQuota: 60, adjustable: true, quotaItems: [{ tier: "T1", quota: 60 }] }] }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ quotaObject: "deepseek-v3", quotaType: "TPM", currentQuota: 100000, defaultQuota: 100000, adjustable: false }] }));

    const usage = await getNovitaUsage({ connectionId: "novita-account-a", apiKey: "key" });
    expect(usage.balance).toMatchObject({ availableBalance: 1, cashBalance: 0.8, creditLimit: 2, pendingCharges: 0.01 });
    expect(usage.rateLimits).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "RPM", currentLimit: 60, adjustable: true, unit: "requests/min" }),
      expect.objectContaining({ metric: "TPM", currentLimit: 100000, unit: "tokens/min" }),
    ]));
    expect(usage.rateLimits.every((row) => row.used === null)).toBe(true);
    expect(parseQuotaData("novita", usage)[0]).toMatchObject({
      name: "Available balance",
      remainingPercentage: 50,
      unit: "USD",
    });
  });

  it("does not invent a 100% quota when Novita has no fixed credit limit", () => {
    expect(parseBalanceResponse({ availableBalance: "10000", cashBalance: "10000", creditLimit: "0", pendingCharges: "0", outstandingInvoices: "0" })).toMatchObject({
      availableBalance: 1,
      creditLimit: 0,
    });
    const rows = parseQuotaData("novita", {
      native: { status: "ok" },
      quotas: {
        balance: { availableBalance: 1, used: null, total: null, percentageAvailable: false, unit: "USD", displayValue: "$1.0000 available", displayTotal: "No fixed credit limit", limitLabel: "No fixed limit" },
      },
    });
    expect(rows[0]).toMatchObject({ percentageAvailable: false, limitLabel: "No fixed limit" });
  });

  it("parses official quota list rows and handles unknown metric values safely", () => {
    const rows = parseNovitaQuotaList({ data: [
      { quotaObject: "deepseek-v3", quotaType: "RPM", currentQuota: 60, defaultQuota: 120, adjustable: true },
      { quotaObject: "bad", quotaType: "IPM", currentQuota: 1, defaultQuota: 1 },
    ] }, "RPM");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ metric: "RPM", quotaObject: "deepseek-v3", currentLimit: 60, defaultLimit: 120, used: null });
  });
});
