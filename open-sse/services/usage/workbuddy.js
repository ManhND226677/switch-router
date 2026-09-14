import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { resolveWorkbuddySession } from "../../executors/workbuddy.js";
import { getProviderModelCatalogStatus } from "../providerModels.js";
import { getObservedUsageForConnection } from "../../../src/lib/db/repos/usageRepo.js";
import { getWorkbuddyCheckinSnapshot } from "../../../src/shared/services/workbuddyAutoCheckin.js";

// Same billing-meter endpoint the WorkBuddy desktop app polls for the credits
// panel (recovered from its app.asar, verified live 2026-09-12). It accepts the
// chat session's Keycloak accessToken directly. The earlier attempt
// (`workbuddy.cn/openapi/v2/credit`) was an Open-Platform API that rejects the
// Keycloak JWT with 401 "access token signature verification failed".
export const WORKBUDDY_RESOURCE_SUMMARY_URL =
  "https://www.workbuddy.ai/billing/meter/get-user-resource-summary";

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isTimeoutError(error) {
  return error?.name === "TimeoutError"
    || error?.name === "AbortError"
    || /timeout|timed out/i.test(String(error?.message || ""));
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
    costUsd: null,
    pricingStatus: "not_applicable",
  };
}

async function readObserved(connectionId) {
  try {
    return await getObservedUsageForConnection(connectionId, "workbuddy");
  } catch {
    return emptyObserved();
  }
}

function nativeUnavailable(status, errorCode, message) {
  const permissionRequired = status === 401 || status === 403;
  return {
    status: permissionRequired ? "permission_required" : "unavailable",
    totalCredits: null,
    usedCredits: null,
    remainingCredits: null,
    remainingPercentage: null,
    source: "workbuddy-billing-meter",
    fetchedAt: null,
    errorCode,
    message,
  };
}

// Credit packages arrive as strings with float noise ("290.43999986") and the
// unit spelling alternates between "credit" and "credits"; keep both alive.
const CREDIT_UNIT = /^credits?$/i;
const round2 = (value) => Math.round(value * 100) / 100;

function parseResourcePackages(payload) {
  const packages = Array.isArray(payload?.data?.Packages) ? payload.data.Packages : null;
  if (!packages) return null;
  let total = 0;
  let used = 0;
  let remaining = 0;
  let seen = 0;
  for (const pkg of packages) {
    if (!pkg || (pkg.CapacityUnit && !CREDIT_UNIT.test(pkg.CapacityUnit))) continue;
    const pkgTotal = finiteNumber(pkg.CycleTotalCapacity);
    const pkgUsed = finiteNumber(pkg.CycleUsedCapacity);
    const pkgRemain = finiteNumber(pkg.CycleRemainCapacity)
      ?? (pkgTotal != null && pkgUsed != null ? Math.max(0, pkgTotal - pkgUsed - (finiteNumber(pkg.CycleFrozenCapacity) ?? 0)) : null);
    if (pkgTotal == null || pkgUsed == null || pkgRemain == null) return null;
    total += pkgTotal;
    used += pkgUsed;
    remaining += pkgRemain;
    seen += 1;
  }
  if (!seen) return null;
  return {
    totalCredits: round2(total),
    usedCredits: round2(used),
    remainingCredits: round2(Math.max(0, remaining)),
  };
}

/**
 * WorkBuddy native credits + gateway-observed history for one connection.
 * Uses the desktop app's billing-meter resource summary, which consumes the
 * current session token directly — no separate Open-Platform credential.
 */
export async function getWorkbuddyUsage({
  connectionId,
  accessToken,
  apiKey,
  providerSpecificData = null,
  proxyOptions = null,
} = {}) {
  const observed = await readObserved(connectionId);
  const catalogStatus = getProviderModelCatalogStatus("workbuddy", connectionId);
  // Last known state from the auto check-in scheduler (null before first tick).
  const checkin = getWorkbuddyCheckinSnapshot(connectionId);
  const session = resolveWorkbuddySession({ accessToken, apiKey, providerSpecificData });
  if (!session?.accessToken) {
    const native = nativeUnavailable(null, "missing_session", "WorkBuddy session is not available.");
    return {
      native,
      observed,
      catalogStatus,
      checkin,
      quotas: {
        native: {
          used: null,
          total: null,
          remainingPercentage: null,
          percentageAvailable: false,
          unit: "credits",
          displayValue: native.message,
          displayTotal: "Native credit API",
          status: native.status,
          source: native.source,
          limitLabel: "Unavailable",
        },
      },
      message: native.message,
      source: native.source,
      fetchedAt: null,
    };
  }

  try {
    const response = await proxyAwareFetch(WORKBUDDY_RESOURCE_SUMMARY_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: "{}",
      signal: AbortSignal.timeout(10000),
    }, proxyOptions);

    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok) {
      const errorCode = `http_${response.status}`;
      const message = response.status === 401 || response.status === 403
        ? "WorkBuddy billing API rejected the session token; local observed usage is still available."
        : `WorkBuddy billing API unavailable (${response.status}); local observed usage is still available.`;
      const native = nativeUnavailable(response.status, errorCode, message);
      return {
        native,
        observed,
        catalogStatus,
      checkin,
        quotas: {
          native: {
            used: null,
            total: null,
            remainingPercentage: null,
            percentageAvailable: false,
            unit: "credits",
            displayValue: message,
            displayTotal: "Native credit API",
            status: native.status,
            source: native.source,
            limitLabel: native.status === "permission_required" ? "Permission required" : "Unavailable",
          },
        },
        message,
        source: native.source,
        fetchedAt: null,
      };
    }

    const credits = parseResourcePackages(payload);
    if (!credits) {
      const native = nativeUnavailable(null, "invalid_schema", "WorkBuddy credit response was invalid; local observed usage is still available.");
      return {
        native,
        observed,
        catalogStatus,
      checkin,
        quotas: {
          native: {
            used: null,
            total: null,
            remainingPercentage: null,
            percentageAvailable: false,
            unit: "credits",
            displayValue: native.message,
            displayTotal: "Native credit API",
            status: native.status,
            source: native.source,
            limitLabel: "Unavailable",
          },
        },
        message: native.message,
        source: native.source,
        fetchedAt: null,
      };
    }

    const { totalCredits, usedCredits, remainingCredits } = credits;
    const remainingPercentage = totalCredits > 0
      ? Math.round((remainingCredits / totalCredits) * 100)
      : null;
    const fetchedAt = new Date().toISOString();
    const native = {
      status: "ok",
      totalCredits,
      usedCredits,
      remainingCredits,
      remainingPercentage,
      source: "workbuddy-billing-meter",
      fetchedAt,
    };
    return {
      native,
      observed,
      catalogStatus,
      checkin,
      quotas: {
        credits: {
          used: usedCredits,
          total: totalCredits,
          remaining: remainingCredits,
          remainingPercentage,
          percentageAvailable: totalCredits > 0,
          unit: "credits",
          displayValue: `${usedCredits.toLocaleString()} used · ${remainingCredits.toLocaleString()} remaining`,
          displayTotal: `${totalCredits.toLocaleString()} total credits`,
          status: "ok",
          source: native.source,
        },
      },
      message: null,
      source: native.source,
      fetchedAt,
    };
  } catch (error) {
    const native = nativeUnavailable(
      null,
      isTimeoutError(error) ? "timeout" : "network_error",
      `WorkBuddy native credit API unavailable (${isTimeoutError(error) ? "timeout" : "network error"}); local observed usage is still available.`,
    );
    return {
      native,
      observed,
      catalogStatus,
      checkin,
      quotas: {
        native: {
          used: null,
          total: null,
          remainingPercentage: null,
          percentageAvailable: false,
          unit: "credits",
          displayValue: native.message,
          displayTotal: "Native credit API",
          status: native.status,
          source: native.source,
          limitLabel: "Unavailable",
        },
      },
      message: native.message,
      source: native.source,
      fetchedAt: null,
    };
  }
}
