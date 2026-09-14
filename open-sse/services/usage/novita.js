import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import {
  NOVITA_BALANCE_URL,
  NOVITA_QUOTA_LIST_URL,
} from "../../providers/novita.js";
import { getProviderModelCatalogStatus } from "../providerModels.js";
import { getObservedUsageForConnection } from "../../../src/lib/db/repos/usageRepo.js";

const QUOTA_TYPES = ["RPM", "TPM"];

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isTimeoutError(error) {
  return error?.name === "TimeoutError"
    || error?.name === "AbortError"
    || /timeout|timed out/i.test(String(error?.message || ""));
}

function usdFromMinorUnits(value) {
  const number = finiteNumber(value);
  return number === null ? null : Math.max(0, number / 10000);
}

function emptyObserved() {
  return {
    scope: "local",
    period: "all",
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    lastUsed: null,
    costUsd: 0,
    pricingStatus: "no_data",
  };
}

async function readObserved(connectionId) {
  try {
    return await getObservedUsageForConnection(connectionId, "novita");
  } catch {
    return emptyObserved();
  }
}

function parseBalanceResponse(payload) {
  const root = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  if (!root || typeof root !== "object") return null;
  const fields = {
    availableBalance: usdFromMinorUnits(root.availableBalance),
    cashBalance: usdFromMinorUnits(root.cashBalance),
    creditLimit: usdFromMinorUnits(root.creditLimit),
    pendingCharges: usdFromMinorUnits(root.pendingCharges),
    outstandingInvoices: usdFromMinorUnits(root.outstandingInvoices),
  };
  if (fields.availableBalance === null) return null;
  return { ...fields, currency: "USD", unit: "USD" };
}

function quotaItemsFromPayload(payload) {
  const data = payload?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.quotas)) return data.quotas;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function normalizeQuotaRow(raw, requestedMetric, index) {
  if (!raw || typeof raw !== "object") return null;
  const metric = String(raw.quotaType || raw.quota_type || requestedMetric || "").toUpperCase();
  if (!QUOTA_TYPES.includes(metric)) return null;
  const currentLimit = finiteNumber(raw.currentQuota ?? raw.current_limit ?? raw.currentLimit);
  const defaultLimit = finiteNumber(raw.defaultQuota ?? raw.default_limit ?? raw.defaultLimit);
  if (currentLimit === null && defaultLimit === null) return null;
  const quotaObject = String(raw.quotaObject || raw.quota_object || raw.model || raw.modelId || "account").trim() || "account";
  const unit = metric === "RPM" ? "requests/min" : "tokens/min";
  const quotaItems = Array.isArray(raw.quotaItems)
    ? raw.quotaItems
        .filter((item) => item && typeof item === "object")
        .map((item) => ({ tier: item.tier || null, quota: finiteNumber(item.quota) }))
        .filter((item) => item.quota !== null)
    : [];
  const tier = raw.tier || raw.accountTier || raw.account_tier || null;
  const adjustable = raw.adjustable === true
    || (typeof raw.adjustable === "string" && raw.adjustable.trim().toLowerCase() === "true");
  const label = currentLimit !== null ? currentLimit.toLocaleString() : "Not published";
  const defaultLabel = defaultLimit !== null ? defaultLimit.toLocaleString() : "Not published";

  return {
    metric,
    currentLimit,
    defaultLimit,
    adjustable,
    quotaObject,
    model: quotaObject === "account" ? null : quotaObject,
    unit,
    tier,
    quotaItems,
    source: "novita-quota-api",
    status: "ok",
    index,
    // Do not expose a fake used:0; RPM/TPM are limits, not usage counters.
    used: null,
    total: null,
    percentageAvailable: false,
    displayValue: `Current ${label} ${unit}`,
    displayTotal: `Default ${defaultLabel} ${unit}${adjustable ? " · adjustable" : ""}`,
    limitLabel: `${metric} limit`,
  };
}

export function parseNovitaQuotaList(payload, requestedMetric) {
  return quotaItemsFromPayload(payload)
    .map((item, index) => normalizeQuotaRow(item, requestedMetric, index))
    .filter(Boolean);
}

async function fetchJson(url, apiKey, proxyOptions) {
  const response = await proxyAwareFetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(10000),
  }, proxyOptions);
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  return { response, payload };
}

function errorCode(response, fallback = "network_error") {
  return response ? `http_${response.status}` : fallback;
}

function balanceQuota(balance, errorMessage = null) {
  if (!balance) {
    const permissionRequired = /http_(401|403)/.test(errorMessage || "");
    return {
      used: null,
      total: null,
      remainingPercentage: null,
      percentageAvailable: false,
      unit: "USD",
      displayValue: errorMessage || "Novita balance unavailable",
      displayTotal: "Balance API",
      status: permissionRequired ? "permission_required" : errorMessage ? "unavailable" : "unknown",
      source: "novita-balance-api",
      limitLabel: permissionRequired ? "Permission required" : errorMessage ? "Unavailable" : "Not published",
    };
  }

  const hasCreditLimit = balance.creditLimit !== null && balance.creditLimit > 0;
  const used = hasCreditLimit
    ? Math.max(0, balance.creditLimit - (balance.availableBalance || 0))
    : null;
  const remainingPercentage = hasCreditLimit
    ? Math.round(Math.max(0, Math.min(100, (balance.availableBalance / balance.creditLimit) * 100)))
    : null;
  return {
    used,
    total: hasCreditLimit ? balance.creditLimit : null,
    remaining: balance.availableBalance,
    remainingPercentage,
    percentageAvailable: hasCreditLimit,
    unit: "USD",
    displayValue: `$${balance.availableBalance.toFixed(4)} available`,
    displayTotal: hasCreditLimit
      ? `$${balance.creditLimit.toFixed(4)} credit limit`
      : "No fixed credit limit",
    status: "ok",
    source: "novita-balance-api",
    limitLabel: hasCreditLimit ? "Available" : "No fixed limit",
  };
}

/** Novita wallet balance, account rate limits and local token observations. */
export async function getNovitaUsage({ connectionId, apiKey, proxyOptions = null } = {}) {
  const observed = await readObserved(connectionId);
  const catalogStatus = getProviderModelCatalogStatus("novita", connectionId);
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!key) {
    const message = "Novita API key is not available.";
    return {
      native: { status: "unavailable", source: "novita-balance-api", fetchedAt: null, errorCode: "missing_api_key" },
      balance: null,
      rateLimits: [],
      observed,
      catalogStatus,
      quotas: { balance: balanceQuota(null, message) },
      message,
      source: "novita-balance-api",
      fetchedAt: null,
    };
  }

  let balance = null;
  let balanceError = null;
  let balanceResponse = null;
  try {
    const result = await fetchJson(NOVITA_BALANCE_URL, key, proxyOptions);
    balanceResponse = result.response;
    if (result.response.ok) balance = parseBalanceResponse(result.payload);
    if (!balance) balanceError = errorCode(result.response, "invalid_schema");
  } catch (error) {
    balanceError = isTimeoutError(error) ? "timeout" : "network_error";
  }

  const rateLimits = [];
  const quotaErrors = [];
  await Promise.all(QUOTA_TYPES.map(async (metric) => {
    try {
      const params = new URLSearchParams({
        modal: "llm",
        quotaType: metric,
        productType: "Public Endpoint",
        quotaObject: "",
      });
      const result = await fetchJson(`${NOVITA_QUOTA_LIST_URL}?${params.toString()}`, key, proxyOptions);
      if (!result.response.ok) {
        quotaErrors.push(errorCode(result.response));
        return;
      }
      rateLimits.push(...parseNovitaQuotaList(result.payload, metric));
    } catch (error) {
      quotaErrors.push(isTimeoutError(error) ? "timeout" : "network_error");
    }
  }));
  rateLimits.sort((a, b) => a.metric.localeCompare(b.metric) || a.quotaObject.localeCompare(b.quotaObject));

  const quotas = { balance: balanceQuota(balance, balanceError ? `Novita balance unavailable (${balanceError}).` : null) };
  rateLimits.forEach((row, index) => {
    quotas[`rate:${row.metric}:${row.quotaObject}:${index}`] = row;
  });

  const permissionError = [balanceError, ...quotaErrors].some((code) => code === "http_401" || code === "http_403");
  const allUnavailable = !balance && rateLimits.length === 0;
  const status = permissionError ? "permission_required" : allUnavailable ? "unavailable" : "ok";
  const messages = [];
  if (balanceError) messages.push(`balance ${balanceError}`);
  if (quotaErrors.length) messages.push(`rate limits ${[...new Set(quotaErrors)].join(", ")}`);
  const message = messages.length
    ? `Novita ${messages.join("; ")}. Local observed usage is still available.`
    : null;
  const fetchedAt = new Date().toISOString();

  return {
    native: {
      status,
      source: "novita-openapi",
      fetchedAt,
      errorCode: messages.length ? messages.join(",") : null,
    },
    balance,
    rateLimits,
    observed,
    catalogStatus,
    quotas,
    message,
    source: "novita-openapi",
    fetchedAt,
    // Kept for diagnostics/UI without leaking the key or response body.
    meta: {
      balanceHttpStatus: balanceResponse?.status || null,
      rateLimitCount: rateLimits.length,
      rateLimitErrors: [...new Set(quotaErrors)],
      currency: "USD",
    },
  };
}

export { parseBalanceResponse, usdFromMinorUnits };
