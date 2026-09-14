import { saveRequestUsage, appendRequestLog, saveRequestDetail } from "../../../src/lib/usageDb.js";
import { COLORS } from "../../utils/stream.js";
import { canonicalizeUsage } from "../../utils/usageTracking.js";

const OPTIONAL_PARAMS = [
  "temperature", "top_p", "top_k",
  "max_tokens", "max_completion_tokens",
  "thinking", "reasoning", "enable_thinking",
  "presence_penalty", "frequency_penalty",
  "seed", "stop", "tools", "tool_choice",
  "response_format", "prediction", "store", "metadata",
  "n", "logprobs", "top_logprobs", "logit_bias",
  "user", "parallel_tool_calls"
];

export function extractRequestConfig(body, stream) {
  const config = { messages: body.messages || [], model: body.model, stream };
  for (const param of OPTIONAL_PARAMS) {
    if (body[param] !== undefined) config[param] = body[param];
  }
  return config;
}

export function extractUsageFromResponse(responseBody) {
  if (!responseBody || typeof responseBody !== "object") return null;

  // Claude format
  if (responseBody.usage?.input_tokens !== undefined) {
    return {
      prompt_tokens: responseBody.usage.input_tokens || 0,
      completion_tokens: responseBody.usage.output_tokens || 0,
      cache_read_input_tokens: responseBody.usage.cache_read_input_tokens,
      cache_creation_input_tokens: responseBody.usage.cache_creation_input_tokens
    };
  }

  // OpenAI format
  if (responseBody.usage?.prompt_tokens !== undefined) {
    return {
      prompt_tokens: responseBody.usage.prompt_tokens || 0,
      completion_tokens: responseBody.usage.completion_tokens || 0,
      cached_tokens: responseBody.usage.prompt_tokens_details?.cached_tokens,
      reasoning_tokens: responseBody.usage.completion_tokens_details?.reasoning_tokens
    };
  }

  // Gemini format
  if (responseBody.usageMetadata) {
    return {
      prompt_tokens: responseBody.usageMetadata.promptTokenCount || 0,
      completion_tokens: responseBody.usageMetadata.candidatesTokenCount || 0,
      cached_tokens: responseBody.usageMetadata.cachedContentTokenCount || 0,
      reasoning_tokens: responseBody.usageMetadata.thoughtsTokenCount || 0
    };
  }

  return null;
}

/**
 * True when a response carries no token accounting at all — the upstream never
 * reported usage and there was nothing to estimate from. Worth distinguishing
 * from a genuinely 0-token response because the Usage screens sum these rows:
 * without the marker a request we could not measure looks like a free one.
 *
 * Callers apply this only at a TERMINAL write. The streaming placeholder row
 * written before the response completes is also 0/0 by construction and must
 * not be flagged.
 */
export function isUsageMissing(tokens) {
  if (!tokens || typeof tokens !== "object") return true;
  const inTokens = Number(tokens.input_tokens ?? tokens.prompt_tokens) || 0;
  const outTokens = Number(tokens.output_tokens ?? tokens.completion_tokens) || 0;
  return inTokens === 0 && outTokens === 0;
}

export function buildRequestDetail(base, overrides = {}) {
  return {
    provider: base.provider || "unknown",
    model: base.model || "unknown",
    connectionId: base.connectionId || undefined,
    timestamp: new Date().toISOString(),
    latency: base.latency || { ttft: 0, total: 0 },
    tokens: base.tokens || { prompt_tokens: 0, completion_tokens: 0 },
    request: base.request,
    providerRequest: base.providerRequest || null,
    providerResponse: base.providerResponse || null,
    response: base.response || {},
    pxpipe: base.pxpipe || undefined,
    contextGuard: base.contextGuard || undefined,
    status: base.status || "success",
    // Mirrors usageHistory.meta.usageMissing so both tables describe the same
    // condition the same way. Omitted entirely when usage was captured.
    ...(base.usageMissing ? { usageMissing: true } : {}),
    ...overrides
  };
}

// Build the "done" summary: duration, ttft, in/out tokens with cache breakdown
export function formatDoneLine({ usage, latency }) {
  const u = usage || {};
  const inTok = u.prompt_tokens ?? u.input_tokens ?? 0;
  const outTok = u.completion_tokens ?? u.output_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? u.cached_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0;
  const cacheCreate = u.cache_creation_input_tokens ?? 0;
  let inStr = `IN ${inTok}`;
  if (cacheRead || cacheCreate) {
    const parts = [];
    if (cacheRead) parts.push(`↻${cacheRead}`);
    if (cacheCreate) parts.push(`+${cacheCreate}`);
    inStr += ` (CACHE ${parts.join(" ")})`;
  }
  const ttftStr = latency?.ttft ? ` · TTFT ${latency.ttft}ms` : "";
  const attemptsStr = latency?.attempts > 1 ? ` · ${latency.attempts} ACC` : "";
  return `DONE ${latency?.total ?? 0}ms${ttftStr}${attemptsStr} · ${inStr} · OUT ${outTok}`;
}

export function saveUsageStats({ provider, model, tokens, connectionId, apiKey, endpoint, label = "USAGE", silent = false }) {
  const inTokens = Number(tokens?.input_tokens ?? tokens?.prompt_tokens) || 0;
  const outTokens = Number(tokens?.output_tokens ?? tokens?.completion_tokens) || 0;

  // A request that reached the provider and answered 200 must still be counted
  // even when no token usage could be captured (provider never sends it, or the
  // stream carried no text to estimate from). Dropping it here is what made
  // successful requests invisible on the Usage/Stats screens. The 0-token row
  // adds nothing to token/cost sums; `meta.usageMissing` marks it so it can be
  // told apart from a real 0-token response.
  const usageMissing = isUsageMissing(tokens);

  if (!silent) {
    const time = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const accountSuffix = connectionId ? ` | account=${connectionId.slice(0, 8)}...` : "";
    const missingSuffix = usageMissing ? " | usage=missing" : "";
    console.log(`${COLORS.green}[${time}] 📊 [${label}] ${provider.toUpperCase()} | in=${inTokens} | out=${outTokens}${accountSuffix}${missingSuffix}${COLORS.reset}`);
  }

  // Canonicalize to one storage convention (prompt_tokens cache-inclusive) so
  // cached/cache-creation tokens survive to cost calc + stats. See canonicalizeUsage.
  const normalized = usageMissing
    ? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    : (canonicalizeUsage(tokens) || {
      prompt_tokens: tokens.prompt_tokens ?? tokens.input_tokens ?? 0,
      completion_tokens: tokens.completion_tokens ?? tokens.output_tokens ?? 0
    });

  // Intentionally NOT .catch()-ed: saveRequestUsage returns a thenable whose
  // first consumer forces an immediate flush — leaving it unconsumed keeps this
  // hot-path call batched (write-behind). Flush errors are logged internally.
  saveRequestUsage({
    provider: provider || "unknown",
    model: model || "unknown",
    tokens: normalized,
    timestamp: new Date().toISOString(),
    connectionId: connectionId || undefined,
    apiKey: apiKey || undefined,
    endpoint: endpoint || null,
    ...(usageMissing ? { meta: { usageMissing: true } } : {})
  });
}
