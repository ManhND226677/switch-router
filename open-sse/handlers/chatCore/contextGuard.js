import { parseUpstreamError } from "../../utils/error.js";
import { classifyContextOverflow } from "../../context-guard/errorUnwrap.js";
import { resolveBudget } from "../../context-guard/budget.js";
import { planAndApplyTrim } from "../../context-guard/trimmer.js";

/**
 * Recover from a context-window overflow the provider already confirmed.
 *
 * This runs where the response is still in hand and `translatedBody` is the
 * exact dispatch-format payload: classify the error, shrink the payload to the
 * window the provider reported, then re-dispatch it once to the SAME
 * credentials. Retrying inside handleChatCore instead of the account loop is
 * what stops one oversized turn from fanning out across every account behind
 * the model; the budget is a single re-dispatch, so a second overflow goes
 * back to the caller as the terminal error it always was.
 *
 * Every response body is consumed while parsing, so `error` always describes
 * the response the caller is left holding — it must reuse it, not re-read.
 *
 * @returns {Promise<{ matched: boolean, recovered?: boolean, error: object,
 *   overflow?: object, stats?: object, reason?: string,
 *   response?: Response, url?: string, headers?: object, transformedBody?: object }>}
 */
export async function tryRecoverContextOverflow({
  providerResponse, providerAdapter, provider, model, translatedBody,
  stream, credentials, signal, log, proxyOptions, fastFail5xx,
  autoTrim, marginPct,
}) {
  const parsed = await parseUpstreamError(providerResponse, providerAdapter);
  const overflow = classifyContextOverflow(providerResponse.status, parsed.message);
  if (!overflow) return { matched: false, error: parsed };
  if (!autoTrim) return { matched: true, error: parsed, overflow, reason: "auto-trim-disabled" };

  const budget = resolveBudget({ classification: overflow, provider, model, body: translatedBody, marginPct });
  if (!budget) return { matched: true, error: parsed, overflow, reason: "no-reliable-window" };

  const stats = planAndApplyTrim({ body: translatedBody, budget });
  if (!stats?.changed) return { matched: true, error: parsed, overflow, stats, reason: stats?.reason || "nothing-trimmed" };

  let retry;
  try {
    retry = await providerAdapter.execute({
      model, body: translatedBody, stream, credentials, signal, log, proxyOptions, fastFail5xx,
    });
  } catch (error) {
    return { matched: true, error: { statusCode: 502, message: error?.message || "Retry after trim failed" }, overflow, stats, reason: "retry-threw", firstError: parsed.message };
  }

  if (retry.response?.ok) {
    return {
      matched: true, recovered: true, error: null, overflow, stats, firstError: parsed.message,
      response: retry.response, url: retry.url, headers: retry.headers, transformedBody: retry.transformedBody,
    };
  }
  const retryParsed = await parseUpstreamError(retry.response, providerAdapter);
  return { matched: true, error: retryParsed, overflow, stats, reason: "retry-failed", firstError: parsed.message };
}

/**
 * Compact record for request details, the log line and (later) the response
 * header. Null unless an overflow was confirmed, so a normal request persists
 * exactly what it did before this feature existed.
 */
export function summarizeContextGuard(guard) {
  if (!guard?.matched) return null;
  const stats = guard.stats;
  return {
    overflow: true,
    trimmed: !!stats?.changed,
    recovered: !!guard.recovered,
    reason: guard.reason,
    dropped: stats?.itemsDropped ?? 0,
    groups: stats?.groupsDropped ?? 0,
    totalItems: stats?.totalItems,
    estBefore: stats?.estBefore,
    estAfter: stats?.estAfter,
    inputBudget: stats?.inputBudget,
    max: stats?.max,
    outputClamped: !!stats?.outputClamped,
    stillOver: !!stats?.stillOver,
    overflowMessage: typeof guard.firstError === "string" ? guard.firstError.slice(0, 400) : undefined,
  };
}
