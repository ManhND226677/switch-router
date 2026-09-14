import { CONTEXT_TRIM_RESPONSE_HEADER } from "../config/runtimeConfig.js";

const EXPOSE_HEADER = "Access-Control-Expose-Headers";

/** `applied; dropped=7; before=301000; after=241000; budget=252000` */
export function contextTrimHeaderValue(summary) {
  if (!summary?.overflow) return null;
  if (!summary.trimmed) return `refused; reason=${summary.reason || "unknown"}`;
  const parts = [`dropped=${summary.dropped}`];
  if (Number.isFinite(summary.estBefore)) parts.push(`before=${summary.estBefore}`);
  if (Number.isFinite(summary.estAfter)) parts.push(`after=${summary.estAfter}`);
  if (Number.isFinite(summary.inputBudget)) parts.push(`budget=${summary.inputBudget}`);
  if (summary.outputClamped) parts.push("output=clamped");
  if (summary.stillOver) parts.push("over=true");
  return `applied; ${parts.join("; ")}`;
}

/**
 * Tell the client its answer was built on a trimmed conversation.
 *
 * The gateway rebuilds every outgoing response's headers, so nothing carries
 * over on its own — and without the expose entry a browser-side fetch cannot
 * read a custom header at all. Accepts either a handler result
 * (`{ success, response }`) or a bare Response, and response headers are
 * mutable, so annotating at the return site beats threading an extra argument
 * through every handler.
 */
export function annotateContextGuard(result, summary) {
  const response = result?.response ?? result;
  const value = contextTrimHeaderValue(summary);
  if (!value || !response?.headers || response.headers.has(CONTEXT_TRIM_RESPONSE_HEADER)) return result;
  try {
    response.headers.set(CONTEXT_TRIM_RESPONSE_HEADER, value);
    response.headers.append(EXPOSE_HEADER, CONTEXT_TRIM_RESPONSE_HEADER);
  } catch {
    // A frozen or unexpected response shape must never fail an otherwise good request.
  }
  return result;
}
