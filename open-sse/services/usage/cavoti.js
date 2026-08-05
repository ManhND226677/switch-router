import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { CAVOTI_USAGE_PATH, resolveCavotiEndpoint } from "../../providers/cavoti.js";

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = toNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function formatNumber(value) {
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function formatCurrency(value) {
  return `$${Number(value).toFixed(4)}`;
}

function addRow(rows, key, name, value, unit, formatter = formatNumber) {
  if (value === null) return;
  rows[key] = {
    name,
    value,
    unit,
    displayValue: `${formatter(value)}${unit ? ` ${unit}` : ""}`,
    percentageAvailable: false,
  };
}

function buildRows(body) {
  const daily = body.daily || body.dailyUsage || body.daily_usage || {};
  const total = body.total || body.totalUsage || body.total_usage || {};
  const rows = {};

  const balance = firstNumber(body.balance, body.balanceUsd, body.balance_usd);
  const remaining = firstNumber(body.remaining, body.remainingBalance, body.remaining_balance);
  addRow(rows, "balance", "Balance", balance, "USD", formatCurrency);
  addRow(rows, "remaining", "Remaining", remaining, "USD", formatCurrency);

  addRow(
    rows,
    "dailyRequests",
    "Daily requests",
    firstNumber(
      daily.requests,
      daily.requestCount,
      daily.request_count,
      body.dailyRequests,
      body.daily_requests,
    ),
    "requests",
  );
  addRow(
    rows,
    "dailyTokens",
    "Daily tokens",
    firstNumber(daily.tokens, daily.tokenCount, daily.token_count, body.dailyTokens, body.daily_tokens),
    "tokens",
  );
  addRow(
    rows,
    "dailyCost",
    "Daily cost",
    firstNumber(daily.cost, daily.totalCost, daily.total_cost, body.dailyCost, body.daily_cost),
    "USD",
    formatCurrency,
  );
  addRow(
    rows,
    "totalRequests",
    "Total requests",
    firstNumber(total.requests, total.requestCount, total.request_count, body.totalRequests, body.total_requests),
    "requests",
  );
  addRow(
    rows,
    "totalTokens",
    "Total tokens",
    firstNumber(total.tokens, total.tokenCount, total.token_count, body.totalTokens, body.total_tokens),
    "tokens",
  );
  addRow(
    rows,
    "totalCost",
    "Total cost",
    firstNumber(total.cost, total.totalCost, total.total_cost, body.totalCost, body.total_cost),
    "USD",
    formatCurrency,
  );
  addRow(rows, "rpm", "RPM", firstNumber(body.rpm, body.requestsPerMinute, body.requests_per_minute), "requests/min");
  addRow(rows, "tpm", "TPM", firstNumber(body.tpm, body.tokensPerMinute, body.tokens_per_minute), "tokens/min");
  addRow(
    rows,
    "averageDuration",
    "Average duration",
    firstNumber(body.averageDuration, body.average_duration, body.avgDuration, body.avg_duration),
    "ms",
  );

  return rows;
}

export function normalizeCavotiUsage(payload) {
  const body = payload?.data && typeof payload.data === "object" ? payload.data : payload || {};
  const balance = firstNumber(body.balance, body.balanceUsd, body.balance_usd);
  const remaining = firstNumber(body.remaining, body.remainingBalance, body.remaining_balance);
  const planName = body.planName || body.plan_name || body.plan || null;
  const mode = body.mode || body.billingMode || body.billing_mode || null;
  const unit = body.unit || body.balanceUnit || body.balance_unit || "USD";

  return {
    ...(planName ? { plan: String(planName), planName: String(planName) } : {}),
    ...(mode ? { mode: String(mode) } : {}),
    balance,
    balanceUnit: unit,
    remaining,
    daily: body.daily || body.dailyUsage || body.daily_usage || null,
    total: body.total || body.totalUsage || body.total_usage || null,
    rpm: firstNumber(body.rpm, body.requestsPerMinute, body.requests_per_minute),
    tpm: firstNumber(body.tpm, body.tokensPerMinute, body.tokens_per_minute),
    averageDuration: firstNumber(body.averageDuration, body.average_duration, body.avgDuration, body.avg_duration),
    quotas: buildRows(body),
  };
}

export async function getCavotiUsage(apiKey, providerSpecificData = {}, proxyOptions = null) {
  if (!apiKey) return { message: "Cavoti API key not available." };

  const url = resolveCavotiEndpoint({
    endpointProfile: providerSpecificData?.endpointProfile,
    capability: "usage",
    path: CAVOTI_USAGE_PATH,
  });

  try {
    const response = await proxyAwareFetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    }, proxyOptions);

    if (response.status === 401 || response.status === 403) {
      return { message: "Cavoti API key invalid or expired." };
    }
    if (!response.ok) {
      return { message: `Cavoti usage API error (${response.status}).` };
    }

    const payload = await response.json();
    const usage = normalizeCavotiUsage(payload);
    if (!usage.plan && usage.balance === null && Object.keys(usage.quotas).length === 0) {
      usage.message = "Cavoti returned no usage data.";
    }
    return usage;
  } catch (error) {
    return { message: `Cavoti usage error: ${error.message}` };
  }
}
