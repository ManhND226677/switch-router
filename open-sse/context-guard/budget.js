import { CONTEXT_GUARD_CONFIG } from "./config.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";

const OUTPUT_FIELDS = ["max_tokens", "max_completion_tokens", "max_output_tokens"];

/** The output ceiling currently in the request body, or 0 when the client left it unset. */
export function readOutputRequest(body) {
  if (!body || typeof body !== "object") return 0;
  const carriers = [body, body.request, body.generationConfig, body.request?.generationConfig];
  for (const carrier of carriers) {
    if (!carrier || typeof carrier !== "object") continue;
    for (const field of OUTPUT_FIELDS) {
      if (Number.isFinite(carrier[field])) return carrier[field];
    }
    if (Number.isFinite(carrier.maxOutputTokens)) return carrier.maxOutputTokens;
  }
  return 0;
}

/**
 * Decide the token budget a retried request must fit into.
 *
 * Tier A: the numbers the upstream itself reported. Tier B: declared capability
 * data. Anything else returns null — the guard refuses to trim rather than
 * invent a window (custom / passthrough models floor at a fabricated 200k).
 *
 * @param {{ classification?: object, provider?: string, model?: string,
 *   body: object, marginPct?: number }} input
 * @returns {null | { max: number, margin: number, inputBudget: number,
 *   reportedInput?: number, source: "upstream" | "capabilities",
 *   outputRequested: number }}
 */
export function resolveBudget({ classification, provider, model, body, marginPct = CONTEXT_GUARD_CONFIG.defaultMarginPct }) {
  const upstreamMax = Number.isFinite(classification?.maxContextTokens) ? classification.maxContextTokens : 0;
  let max = upstreamMax;
  let source = "upstream";

  if (!max) {
    const caps = getCapabilitiesForModel(provider, model);
    if (caps.contextWindowSource !== "declared") return null;
    max = caps.contextWindow;
    source = "capabilities";
  }
  if (!Number.isFinite(max) || max <= 0) return null;

  const pct = Number.isFinite(marginPct) ? Math.min(Math.max(marginPct, 0), 25) : CONTEXT_GUARD_CONFIG.defaultMarginPct;
  const margin = Math.max(CONTEXT_GUARD_CONFIG.minMarginTokens, Math.ceil(max * (pct / 100)));
  // vLLM-family providers count output against the same window, so reserve the
  // output the request is actually asking for.
  const outputRequested = readOutputRequest(body);
  const inputBudget = max - margin - (outputRequested > 0 ? Math.min(outputRequested, max - margin) : 0);
  if (inputBudget <= 0) return null;

  return {
    max,
    margin,
    inputBudget,
    outputRequested,
    reportedInput: Number.isFinite(classification?.inputTokens) ? classification.inputTokens : undefined,
    source,
  };
}

/**
 * Last resort after the conversation is already down to what cannot be cut:
 * shrink the output ceiling so `input + output` fits. Keeps Claude's
 * `max_tokens > thinking.budget_tokens` invariant by lowering the budget too.
 * Writes only fields the body already carries.
 */
export function clampOutputRequest(body, targetOutput) {
  if (!body || typeof body !== "object" || !Number.isFinite(targetOutput) || targetOutput < 256) return false;
  const thinking = body.thinking || body.request?.thinking;
  // With thinking on, `budget_tokens` needs at least 1024 of its own below
  // `max_tokens`. Refuse the clamp rather than emit an invalid body.
  if (Number.isFinite(thinking?.budget_tokens) && targetOutput < 2048) return false;
  const carriers = [body, body.request, body.generationConfig, body.request?.generationConfig];
  let changed = false;
  for (const carrier of carriers) {
    if (!carrier || typeof carrier !== "object") continue;
    for (const field of [...OUTPUT_FIELDS, "maxOutputTokens"]) {
      if (Number.isFinite(carrier[field]) && carrier[field] > targetOutput) {
        carrier[field] = Math.floor(targetOutput);
        changed = true;
      }
    }
  }
  if (changed && Number.isFinite(thinking?.budget_tokens)) {
    thinking.budget_tokens = Math.min(thinking.budget_tokens, Math.floor(targetOutput) - 1024);
  }
  return changed;
}
