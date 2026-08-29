import { CONTEXT_OVERFLOW_TEXTS } from "../config/errorConfig.js";

// Upstream overflow messages arrive double- and triple-encoded: StepFun puts a
// JSON string inside `error.message`, which itself sits inside another JSON
// string. One `JSON.parse` never reaches the human text, so extraction walks
// every level and searches all of them.
const MAX_UNWRAP_DEPTH = 6;

function pickMessageField(node) {
  for (const key of ["error", "detail", "message", "msg"]) {
    const value = node[key];
    if (typeof value === "string" && value) return value;
    if (value && typeof value === "object") {
      const inner = pickMessageField(value);
      if (inner) return inner;
    }
  }
  return "";
}

/**
 * Flatten an upstream error payload into every text layer it contains.
 * @param {unknown} input - raw body text or an already-parsed object
 * @returns {string[]} level 0 is the input as text; later levels are unwrapped
 */
export function unwrapErrorChain(input) {
  const chain = [];
  if (input === null || input === undefined) return chain;
  let text = typeof input === "string"
    ? input
    : (() => { try { return JSON.stringify(input); } catch { return String(input); } })();

  for (let depth = 0; depth <= MAX_UNWRAP_DEPTH; depth += 1) {
    if (!text || chain.includes(text)) return chain;
    chain.push(text);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return chain;
    }
    if (typeof parsed === "string") text = parsed;
    else if (parsed && typeof parsed === "object") text = pickMessageField(parsed);
    else return chain;
  }
  return chain;
}

const num = "(\\d[\\d,]*)";
const NUMERIC_PATTERNS = [
  // Anthropic: "prompt is too long: 210000 tokens > 200000 maximum"
  { re: new RegExp(`prompt is too long[^\\d]*${num}\\s*tokens?[^\\d]*>[^\\d]*${num}`, "i"), input: 1, max: 2 },
  // vLLM / StepFun / OpenAI family — input and output share one window.
  { re: new RegExp(`maximum context length is ${num}\\s*tokens?`, "i"), max: 1 },
  { re: new RegExp(`you requested ${num}\\s*output tokens?`, "i"), output: 1 },
  // Real StepFun/vLLM wording inserts "at least" before the number. The
  // trailing `tokens` is mandatory: the same family also writes
  // "your prompt contains 25000 characters, or 6250 tokens", and reading the
  // first number there would treat characters as tokens.
  { re: new RegExp(`your prompt contains[^\\d]*${num}\\s*(?:input\\s+)?tokens?`, "i"), input: 1 },
  { re: new RegExp(`your request has ${num}\\s*input tokens?`, "i"), input: 1 },
  // Gemini: "The input token count (1000000) exceeds the maximum number of
  // tokens allowed on the model (1000000)"
  { re: new RegExp(`input token count \\(${num}\\)`, "i"), input: 1 },
  { re: new RegExp(`allowed on the model \\(${num}\\)`, "i"), max: 1 },
];

function toInt(raw) {
  const value = Number(String(raw).replace(/[,\s]/g, ""));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function isContextOverflowText(text) {
  if (!text || typeof text !== "string") return false;
  const lower = text.toLowerCase();
  return CONTEXT_OVERFLOW_TEXTS.some(marker => lower.includes(marker));
}

/**
 * Decide whether an upstream failure is a context-window overflow, and pull the
 * real numbers out of it so the caller can size a trimmed retry from the
 * provider's own arithmetic instead of a chars/token guess.
 *
 * @param {number} status - upstream HTTP status
 * @param {string} message - upstream error text (any JSON nesting)
 * @returns {null | { maxContextTokens?: number, inputTokens?: number,
 *   requestedOutputTokens?: number, source: "regex" | "status-only" }}
 */
export function classifyContextOverflow(status, message) {
  const chain = unwrapErrorChain(message);
  const haystack = chain.join("\n");
  // 413 is a size cap regardless of wording; every other status needs a signal.
  const detected = status === 413 || isContextOverflowText(haystack);
  if (!detected) return null;

  const out = { source: "status-only" };
  for (const { re, input, max, output } of NUMERIC_PATTERNS) {
    const match = re.exec(haystack);
    if (!match) continue;
    if (max !== undefined && out.maxContextTokens === undefined) out.maxContextTokens = toInt(match[max]);
    if (input !== undefined && out.inputTokens === undefined) out.inputTokens = toInt(match[input]);
    // `requested 0 output tokens` means nothing was requested — never a clamp target.
    if (output !== undefined && out.requestedOutputTokens === undefined) {
      const requested = Number(String(match[output]).replace(/[,\s]/g, ""));
      if (Number.isFinite(requested) && requested > 0) out.requestedOutputTokens = requested;
    }
  }
  if (out.maxContextTokens !== undefined || out.inputTokens !== undefined) out.source = "regex";
  return out;
}
