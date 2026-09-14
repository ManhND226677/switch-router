/**
 * Unstoppable Code (Canopy Cloud) usage — AI Credits.
 *
 * Two public endpoints on the same host as the LLM proxy, both authenticated with
 * the connection's cskToken (Bearer):
 *   GET /api/v1/ai-credits/balance      → { credits, dailyDripCapCredits, eligible,
 *                                           source, orgPool, orgFundingAvailable, email }
 *   GET /api/v1/ai-credits/subscription → { active, plan, renewsAt, source, email }
 *
 * Semantics taken from the desktop app's own balance consumer
 * (`welcomeCreditsRemaining`): `credits` is the REMAINING balance and
 * `dailyDripCapCredits` is the daily refill ceiling, i.e. the denominator used for
 * the "<20% left" warning. The daily drip only applies to free/drip accounts —
 * when a paid subscription is active, or the credits come from an org pool, there
 * is no meaningful cap and only the remaining balance is shown.
 */

import { PROVIDERS } from "../../providers/index.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { toFiniteNumber } from "./shared.js";

const DEFAULT_BALANCE_URL = "https://app.unstoppable.ai/api/v1/ai-credits/balance";
const DEFAULT_SUBSCRIPTION_URL = "https://app.unstoppable.ai/api/v1/ai-credits/subscription";

const balanceUrl = () => PROVIDERS.unstoppable?.usage?.url || DEFAULT_BALANCE_URL;
const subscriptionUrl = () => PROVIDERS.unstoppable?.usage?.subscriptionUrl || DEFAULT_SUBSCRIPTION_URL;

const SOURCE = "unstoppable-ai-credits";

function unavailable(status, errorCode, message) {
  return {
    status: status === null ? "unavailable" : `http_${status}`,
    errorCode,
    message,
    totalCredits: null,
    usedCredits: null,
    remainingCredits: null,
    remainingPercentage: null,
    plan: null,
    subscriptionActive: null,
    renewsAt: null,
    source: SOURCE,
    fetchedAt: null,
  };
}

function quotaRow(native, { limitLabel = null } = {}) {
  const { totalCredits, usedCredits, remainingCredits, remainingPercentage } = native;
  return {
    used: usedCredits,
    total: totalCredits,
    remaining: remainingCredits,
    remainingPercentage,
    percentageAvailable: typeof remainingPercentage === "number",
    unit: "credits",
    displayValue: typeof remainingCredits === "number"
      ? `${remainingCredits.toLocaleString()} credits`
      : native.message,
    displayTotal: typeof totalCredits === "number"
      ? `${totalCredits.toLocaleString()} daily cap`
      : "AI Credits",
    status: native.status,
    source: native.source,
    ...(limitLabel ? { limitLabel } : {}),
  };
}

export async function getUnstoppableUsage({ accessToken, apiKey, proxyOptions = null } = {}) {
  const token = accessToken || apiKey;
  if (!token) {
    const native = unavailable(null, "missing_token", "Unstoppable credential is not available.");
    return {
      native,
      quotas: { credits: quotaRow(native, { limitLabel: "Unavailable" }) },
      message: native.message,
      source: SOURCE,
      fetchedAt: null,
    };
  }

  const headers = { Accept: "application/json", Authorization: `Bearer ${token}` };
  const signal = AbortSignal.timeout(10000);

  // Subscription is best-effort: the balance alone is still useful without it.
  const [balanceRes, subscriptionRes] = await Promise.all([
    proxyAwareFetch(balanceUrl(), { method: "GET", headers, signal }, proxyOptions).catch(() => null),
    proxyAwareFetch(subscriptionUrl(), { method: "GET", headers, signal }, proxyOptions).catch(() => null),
  ]);

  if (!balanceRes || !balanceRes.ok) {
    const status = balanceRes ? balanceRes.status : null;
    const message = status === 401 || status === 403
      ? "Unstoppable rejected the credential — sign in again on the dashboard."
      : status === null
        ? "Unstoppable AI Credits API is unreachable (network error)."
        : `Unstoppable AI Credits API unavailable (HTTP ${status}).`;
    const native = unavailable(status, status === null ? "network_error" : "http_error", message);
    return {
      native,
      quotas: { credits: quotaRow(native, { limitLabel: "Unavailable" }) },
      message,
      source: SOURCE,
      fetchedAt: null,
    };
  }

  const balance = await balanceRes.json().catch(() => null);
  const subscription = subscriptionRes?.ok
    ? await subscriptionRes.json().catch(() => null)
    : null;

  const remaining = Number(balance?.credits);
  if (!Number.isFinite(remaining)) {
    const native = unavailable(balanceRes.status, "invalid_schema", "Unstoppable credit response was invalid.");
    return {
      native,
      quotas: { credits: quotaRow(native, { limitLabel: "Unavailable" }) },
      message: native.message,
      source: SOURCE,
      fetchedAt: null,
    };
  }

  const subscriptionActive = typeof subscription?.active === "boolean" ? subscription.active : null;
  const plan = typeof subscription?.plan === "string" && subscription.plan.trim()
    ? subscription.plan.trim()
    : null;
  const renewsAt = typeof subscription?.renewsAt === "string" ? subscription.renewsAt : null;

  const dailyCap = toFiniteNumber(balance?.dailyDripCapCredits, NaN);
  // The daily drip is the only cap we know, and it does not apply to paid seats or
  // org-funded pools — those show the balance alone rather than a fabricated bar.
  const capApplies = Number.isFinite(dailyCap) && dailyCap > 0
    && !balance?.orgPool
    && subscriptionActive !== true;

  const totalCredits = capApplies ? dailyCap : null;
  const usedCredits = capApplies ? Math.max(0, dailyCap - remaining) : null;
  const remainingPercentage = capApplies
    ? Math.max(0, Math.min(100, Math.round((remaining / dailyCap) * 100)))
    : null;

  const fetchedAt = new Date().toISOString();
  const native = {
    status: "ok",
    totalCredits,
    usedCredits,
    remainingCredits: remaining,
    remainingPercentage,
    eligible: typeof balance?.eligible === "boolean" ? balance.eligible : null,
    plan,
    subscriptionActive,
    renewsAt,
    source: SOURCE,
    fetchedAt,
  };

  const capNote = capApplies ? null : "remaining balance (no daily cap)";
  return {
    native,
    quotas: {
      credits: {
        ...quotaRow(native),
        displayValue: `${remaining.toLocaleString()} credits remaining`,
        displayTotal: capApplies
          ? `${dailyCap.toLocaleString()} daily cap`
          : capNote,
      },
    },
    message: null,
    plan: plan || "AI Credits",
    source: SOURCE,
    fetchedAt,
  };
}
