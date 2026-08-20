/**
 * Misc usage handlers (Qwen, Ollama, GLM, Qoder, ViLao, StepFun)
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U } from "./shared.js";
import {
  resolveVilaoConnectionEndpoint,
  VILAO_MODELS_PATH,
  VILAO_BALANCE_PATH,
  VILAO_INFO_PATH,
  normalizeVilaoBaseUrl,
} from "../../providers/vilao.js";
import {
  resolveStepFunApiMode,
  resolveStepFunEndpoints,
  STEPFUN_PAYG_BASE_URL,
} from "../../providers/stepfun.js";

// GLM quota endpoints (region-aware) — url from registry transport.usage
const GLM_QUOTA_URLS = {
  international: U("glm").url,
};

/**
 * Qwen Usage
 */
export async function getQwenUsage(accessToken, providerSpecificData) {
  try {
    const resourceUrl = providerSpecificData?.resourceUrl;
    if (!resourceUrl) {
      return { message: "Qwen connected. No resource URL available." };
    }

    // Qwen may have usage endpoint at resource URL
    return { message: "Qwen connected. Usage tracked per request." };
  } catch (error) {
    return { message: "Unable to fetch Qwen usage." };
  }
}

/**
 * Ollama Cloud Usage
 * Ollama Cloud uses an API key from ollama.com/settings/keys
 * and has no public usage API — free tier has light usage limits (resets every 5h & 7d).
 * This returns an informational message with the plan details.
 */
export async function getOllamaUsage(accessToken, providerSpecificData) {
  try {
    // Ollama Cloud does not expose a public quota/usage API.
    // The provider is configured as noAuth with a notice explaining limits.
    // We return a graceful message so the UI shows a friendly state instead of an error.
    const plan = providerSpecificData?.plan || "Free";
    return {
      plan,
      message: "Ollama Cloud uses a free tier with light usage limits (resets every 5h & 7d). For detailed usage tracking, visit ollama.com/settings/keys.",
      quotas: [],
    };
  } catch (error) {
    return { message: "Unable to fetch Ollama Cloud usage." };
  }
}

/**
 * GLM Coding Plan usage (international + China regions)
 */
export async function getGlmUsage(apiKey, provider, proxyOptions = null) {
  void provider;
  if (!apiKey) {
    return { message: "GLM API key not available." };
  }

  const quotaUrl = GLM_QUOTA_URLS.international;

  try {
    const response = await proxyAwareFetch(quotaUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    }, proxyOptions);

    if (!response.ok) {
      if (response.status === 401) {
        return { message: "GLM API key invalid or expired." };
      }
      return { message: `GLM quota API error (${response.status}).` };
    }

    const json = await response.json();
    const data = json?.data && typeof json.data === "object" ? json.data : {};
    const limits = Array.isArray(data.limits) ? data.limits : [];
    const quotas = {};

    for (const limit of limits) {
      if (!limit || limit.type !== "TOKENS_LIMIT") continue;
      const usedPercent = Number(limit.percentage) || 0;
      const resetMs = Number(limit.nextResetTime) || 0;
      const remaining = Math.max(0, 100 - usedPercent);

      quotas["session"] = {
        used: usedPercent,
        total: 100,
        remaining,
        remainingPercentage: remaining,
        resetAt: resetMs > 0 ? new Date(resetMs).toISOString() : null,
        unlimited: false,
      };
    }

    const levelRaw = typeof data.level === "string" ? data.level : "";
    const plan = levelRaw
      ? levelRaw.charAt(0).toUpperCase() + levelRaw.slice(1).toLowerCase()
      : "Unknown";

    return { plan, quotas };
  } catch (error) {
    return { message: `GLM error: ${error.message}` };
  }
}

/**
 * Qoder usage
 */
/**
 * ViLao marketplace pay-as-you-go usage.
 *
 * Primary: GET /v1/usage/balance (same payload as /v1/tracking)
 *   { balance, total_spent, total_requests, success_rate, models[], last_request, ... }
 * Discovered via LLM Monitor UI (api.vilao.ai) — not listed under the basic
 * OpenAI chat paths. Auth: Authorization Bearer sk-… or x-api-key.
 *
 * Fallback: GET /v1/models + HTTP 402 empty-wallet semantics when balance
 * endpoint is unavailable.
 */
export async function getVilaoUsage(apiKey, providerSpecificData = {}, proxyOptions = null) {
  if (!apiKey) {
    return { message: "ViLao API key not available." };
  }

  const baseUrl = normalizeVilaoBaseUrl(providerSpecificData?.baseUrl);
  const balanceUrl = resolveVilaoConnectionEndpoint(
    { providerSpecificData },
    VILAO_BALANCE_PATH,
  );
  const modelsUrl = resolveVilaoConnectionEndpoint(
    { providerSpecificData },
    VILAO_MODELS_PATH,
  );
  const infoUrl = resolveVilaoConnectionEndpoint(
    { providerSpecificData },
    VILAO_INFO_PATH,
  );
  const started = Date.now();
  const authHeaders = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };

  let health = "unknown";
  let currencyHint = null;
  try {
    const [healthRes, infoRes] = await Promise.all([
      proxyAwareFetch(`${baseUrl}/health`, { method: "GET", headers: { Accept: "application/json" } }, proxyOptions).catch(() => null),
      proxyAwareFetch(infoUrl, { method: "GET", headers: { Accept: "application/json" } }, proxyOptions).catch(() => null),
    ]);
    if (healthRes?.ok) {
      const body = await healthRes.json().catch(() => null);
      health = body?.status || "healthy";
    } else if (healthRes) {
      health = "down";
    }
    if (infoRes?.ok) {
      const info = await infoRes.json().catch(() => null);
      // Worker reports region + FX; balance unit follows marketplace currency (often VND).
      if (info?.region === "vi" || info?.cny_to_vnd_rate) currencyHint = "VND";
      else if (info?.region) currencyHint = String(info.region).toUpperCase();
    }
  } catch {
    /* health/info are best-effort */
  }

  try {
    const res = await proxyAwareFetch(
      balanceUrl,
      { method: "GET", headers: authHeaders },
      proxyOptions,
    );
    const latencyMs = Date.now() - started;

    if (res.status === 401 || res.status === 403) {
      return {
        plan: "ViLao pay-as-you-go",
        message: res.status === 401 ? "Invalid ViLao API key." : "Access denied by ViLao.",
        health,
        baseUrl,
        latencyMs,
      };
    }

    if (res.status === 402) {
      return {
        plan: "ViLao pay-as-you-go",
        message: "Wallet empty (HTTP 402). Top up credit on vilao.ai console.",
        health,
        baseUrl,
        latencyMs,
        quotas: {
          balance: {
            used: 0,
            total: 0,
            remainingPercentage: 0,
            unlimited: false,
            unit: currencyHint || "credits",
          },
        },
        meta: { keyValid: true, walletEmpty: true, balance: 0, totalSpent: 0 },
      };
    }

    if (res.ok) {
      const body = await res.json().catch(() => null);
      const balance = Number(body?.balance);
      const totalSpent = Number(body?.total_spent);
      const totalRequests = Number(body?.total_requests);
      const successRate = Number(body?.success_rate);
      const models = Array.isArray(body?.models) ? body.models.filter(Boolean) : [];
      const bal = Number.isFinite(balance) ? balance : 0;
      const spent = Number.isFinite(totalSpent) ? totalSpent : 0;
      const lifetime = bal + spent;
      // PAYG has no fixed "cap" — bar = remaining share of (balance + spent).
      const remainingPct = lifetime > 0
        ? Math.max(0, Math.min(100, Math.round((bal / lifetime) * 100)))
        : (bal > 0 ? 100 : 0);
      const empty = bal <= 0;
      const unit = currencyHint || "credits";
      const sym = unit === "VND" ? "₫" : "";
      const fmt = (n) => (Number.isFinite(n)
        ? n.toLocaleString(undefined, { maximumFractionDigits: 2 })
        : "—");

      return {
        plan: "ViLao pay-as-you-go",
        health,
        baseUrl,
        latencyMs,
        // Keep message as a short subtitle only — never the sole body
        // (ProviderLimits hides the table when message is set without quotas).
        message: empty
          ? "Hết tiền — nạp thêm trên vilao.ai"
          : null,
        quotas: {
          // One primary money row: remaining balance is the hero number.
          balance: {
            used: spent,
            total: lifetime > 0 ? lifetime : Math.max(bal, 0),
            remainingPercentage: empty ? 0 : remainingPct,
            // Absolute remaining for the right-side / used line via displayValue.
            remaining: bal,
            unlimited: false,
            unit,
            displayValue: `${fmt(bal)}${sym} còn lại`,
            displayTotal: spent > 0 ? `đã tiêu ${fmt(spent)}${sym}` : null,
          },
          requests: {
            used: Number.isFinite(totalRequests) ? totalRequests : 0,
            total: Number.isFinite(totalRequests) ? totalRequests : 0,
            // No fake % bar for request count — unlimited + displayValue.
            remainingPercentage: undefined,
            percentageAvailable: false,
            unlimited: true,
            unit: "requests",
            displayValue: Number.isFinite(totalRequests)
              ? `${totalRequests.toLocaleString()} requests`
                + (Number.isFinite(successRate) ? ` · ${successRate}% ok` : "")
              : "—",
          },
          models: {
            used: 0,
            total: models.length,
            remainingPercentage: undefined,
            percentageAvailable: false,
            unlimited: true,
            unit: "models",
            displayValue: models.length
              ? `${models.length} model đã subscribe`
              : "Chưa subscribe model",
          },
        },
        meta: {
          keyValid: true,
          walletEmpty: empty,
          balance: bal,
          totalSpent: spent,
          totalRequests: Number.isFinite(totalRequests) ? totalRequests : 0,
          successRate: Number.isFinite(successRate) ? successRate : null,
          modelCount: models.length,
          sampleIds: models.slice(0, 8),
          lastRequest: body?.last_request || null,
          currency: unit,
          avgLast5Cost: body?.avg_last5_cost ?? null,
          avgLast5Tokens: body?.avg_last5_tokens ?? null,
        },
      };
    }

    // Balance endpoint missing/failed — fall back to models catalog probe.
    const modelsRes = await proxyAwareFetch(
      modelsUrl,
      { method: "GET", headers: authHeaders },
      proxyOptions,
    );
    const latencyMs2 = Date.now() - started;
    if (modelsRes.status === 402) {
      return {
        plan: "ViLao pay-as-you-go",
        message: "Wallet empty (HTTP 402). Top up credit on vilao.ai console.",
        health,
        baseUrl,
        latencyMs: latencyMs2,
        quotas: {
          balance: { used: 0, total: 0, remainingPercentage: 0, unlimited: false, unit: currencyHint || "credits" },
        },
        meta: { keyValid: true, walletEmpty: true, balance: 0 },
      };
    }
    if (!modelsRes.ok) {
      return {
        plan: "ViLao pay-as-you-go",
        message: `ViLao usage failed (${res.status}); models probe ${modelsRes.status}.`,
        health,
        baseUrl,
        latencyMs: latencyMs2,
      };
    }
    const json = await modelsRes.json().catch(() => null);
    const list = Array.isArray(json?.data) ? json.data : [];
    return {
      plan: "ViLao pay-as-you-go",
      message: "Balance endpoint unavailable; showing subscribed model count only.",
      health,
      baseUrl,
      latencyMs: latencyMs2,
      quotas: {
        subscribed_models: {
          used: 0,
          total: list.length,
          remainingPercentage: list.length > 0 ? 100 : 0,
          unlimited: false,
          unit: "models",
        },
      },
      meta: {
        keyValid: true,
        walletEmpty: false,
        modelCount: list.length,
        sampleIds: list.slice(0, 8).map((m) => m?.id).filter(Boolean),
      },
    };
  } catch (error) {
    return {
      plan: "ViLao pay-as-you-go",
      message: `ViLao error: ${error.message}`,
      health,
      baseUrl,
    };
  }
}

/**
 * StepFun Token Plan / PAYG account snapshot.
 *
 * Verified endpoints (2026-08-14) with a live key:
 *   GET https://api.stepfun.ai/v1/accounts
 *     → { object, type: "prepaid"|…, balance, total_cash_balance, total_voucher_balance }
 *   GET {step_plan|payg}/v1/models → catalog the key can call
 *
 * There is no separate step_plan /accounts path (404). Token-plan keys still
 * read prepaid balance from the standard /v1/accounts host.
 */
export async function getStepFunUsage(apiKey, providerSpecificData = {}, proxyOptions = null) {
  if (!apiKey) {
    return { message: "StepFun API key not available." };
  }

  const apiMode = resolveStepFunApiMode({ providerSpecificData });
  const endpoints = resolveStepFunEndpoints({ providerSpecificData });
  const accountsUrl = `${STEPFUN_PAYG_BASE_URL}/accounts`;
  const modelsUrl = endpoints.models;
  const started = Date.now();
  const authHeaders = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };

  try {
    const [accRes, modelsRes] = await Promise.all([
      proxyAwareFetch(accountsUrl, { method: "GET", headers: authHeaders }, proxyOptions),
      proxyAwareFetch(modelsUrl, { method: "GET", headers: authHeaders }, proxyOptions).catch(() => null),
    ]);
    const latencyMs = Date.now() - started;

    if (accRes.status === 401 || accRes.status === 403) {
      return {
        plan: apiMode === "payg" ? "StepFun pay-as-you-go" : "StepFun token plan",
        message: accRes.status === 401 ? "Invalid StepFun API key." : "Access denied by StepFun.",
        latencyMs,
        meta: { apiMode, keyValid: false },
      };
    }

    if (!accRes.ok) {
      let detail = "";
      try {
        const errBody = await accRes.json();
        detail = errBody?.error?.message || errBody?.message || "";
      } catch { /* */ }
      return {
        plan: apiMode === "payg" ? "StepFun pay-as-you-go" : "StepFun token plan",
        message: detail || `StepFun accounts probe failed (${accRes.status}).`,
        latencyMs,
        meta: { apiMode, keyValid: accRes.status !== 401 },
      };
    }

    const acc = await accRes.json().catch(() => ({}));
    const balance = Number(acc?.balance);
    const cash = Number(acc?.total_cash_balance);
    const voucher = Number(acc?.total_voucher_balance);
    const bal = Number.isFinite(balance) ? balance : 0;
    const cashBal = Number.isFinite(cash) ? cash : 0;
    const voucherBal = Number.isFinite(voucher) ? voucher : 0;
    const empty = bal <= 0 && cashBal <= 0 && voucherBal <= 0;
    const accType = acc?.type || "prepaid";
    const fmt = (n) => (Number.isFinite(n)
      ? n.toLocaleString(undefined, { maximumFractionDigits: 4 })
      : "—");

    let modelCount = 0;
    let sampleIds = [];
    if (modelsRes?.ok) {
      try {
        const mj = await modelsRes.json();
        const list = Array.isArray(mj?.data) ? mj.data : (Array.isArray(mj) ? mj : []);
        modelCount = list.length;
        sampleIds = list.slice(0, 8).map((m) => m?.id).filter(Boolean);
      } catch { /* */ }
    }

    return {
      plan: apiMode === "payg" ? "StepFun pay-as-you-go" : "StepFun token plan",
      latencyMs,
      message: empty
        ? "Balance is 0 — top up or check token-plan entitlement on platform.stepfun.ai"
        : null,
      quotas: {
        balance: {
          used: 0,
          total: Math.max(bal, 0),
          remainingPercentage: empty ? 0 : 100,
          unlimited: false,
          unit: "credits",
          displayValue: `${fmt(bal)} remaining`,
          displayTotal: accType,
        },
        cash: {
          used: 0,
          total: Math.max(cashBal, 0),
          remainingPercentage: cashBal > 0 ? 100 : 0,
          unlimited: false,
          unit: "credits",
          displayValue: `${fmt(cashBal)} cash`,
          percentageAvailable: false,
        },
        voucher: {
          used: 0,
          total: Math.max(voucherBal, 0),
          remainingPercentage: voucherBal > 0 ? 100 : 0,
          unlimited: false,
          unit: "credits",
          displayValue: `${fmt(voucherBal)} voucher`,
          percentageAvailable: false,
        },
        models: {
          used: 0,
          total: modelCount,
          remainingPercentage: modelCount > 0 ? 100 : 0,
          unlimited: true,
          unit: "models",
          displayValue: modelCount ? `${modelCount} models on plan` : "No models listed",
          percentageAvailable: false,
        },
      },
      meta: {
        keyValid: true,
        walletEmpty: empty,
        balance: bal,
        cashBalance: cashBal,
        voucherBalance: voucherBal,
        accountType: accType,
        apiMode,
        modelCount,
        sampleIds,
      },
    };
  } catch (error) {
    return {
      plan: "StepFun",
      message: `StepFun error: ${error.message}`,
      meta: { apiMode },
    };
  }
}

export async function getQoderUsage(accessToken, proxyOptions = null) {
  if (!accessToken) {
    return { message: "Qoder usage unavailable: no access token" };
  }
  try {
    const response = await proxyAwareFetch(
      U("qoder").url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      },
      proxyOptions,
    );
    if (!response.ok) {
      return { message: `Qoder connected. Usage fetch returned ${response.status}.` };
    }
    const body = await response.json().catch(() => null);
    if (!body) {
      return { message: "Qoder connected. Usage response was not JSON." };
    }
    // Quota records live under `quotas`; scalar metadata
    // (totalUsagePercentage, isQuotaExceeded, expiresAt) are surfaced as
    // siblings so the dashboard parser doesn't try to render them as rows.
    const userQuota = body.userQuota || {};
    const orgQuota = body.orgResourcePackage || {};
    // Qoder publishes a single absolute reset timestamp (`expiresAt` in ms);
    // surface it on every quota record as ISO so the table can render
    // "resets at" alongside used/total.
    const expiresAtMs = Number.isFinite(Number(body.expiresAt)) && Number(body.expiresAt) > 0
      ? Number(body.expiresAt)
      : null;
    const resetAt = expiresAtMs ? new Date(expiresAtMs).toISOString() : null;
    const quotas = {
      user: {
        total: Number(userQuota.total) || 0,
        used: Number(userQuota.used) || 0,
        remaining: Number(userQuota.remaining) || 0,
        unit: userQuota.unit || "credits",
        resetAt,
      },
      organization: {
        total: Number(orgQuota.total) || 0,
        used: Number(orgQuota.used) || 0,
        remaining: Number(orgQuota.remaining) || 0,
        unit: orgQuota.unit || "credits",
        resetAt,
      },
    };
    return {
      quotas,
      totalUsagePercentage: Number(body.totalUsagePercentage) || 0,
      isQuotaExceeded: !!body.isQuotaExceeded,
      expiresAt: expiresAtMs,
    };
  } catch (error) {
    return { message: `Qoder connected. Unable to fetch usage: ${error.message}` };
  }
}
