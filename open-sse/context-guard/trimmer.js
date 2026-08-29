import { CONTEXT_GUARD_CONFIG } from "./config.js";
import { clampOutputRequest } from "./budget.js";
import {
  consumesIds, isPinned, isUserTurn, producesIds, resolveContainer, textChars,
} from "./shape.js";

export const TRIM_NOTICE = "[earlier context trimmed]";

function noticeItem(kind) {
  if (kind === "contents") return { role: "user", parts: [{ text: TRIM_NOTICE }] };
  if (kind === "input") return { type: "message", role: "user", content: [{ type: "input_text", text: TRIM_NOTICE }] };
  return { role: "user", content: TRIM_NOTICE };
}

// The live turn is the last user message and everything after it — an agent
// mid-tool-loop ends on tool results answering calls we must not delete.
function protectedFrom(items, kind) {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (isUserTurn(items[i], kind)) return i;
  }
  return 0;
}

/**
 * Expand a candidate into every item bound to it by a tool-call id, so no
 * `tool_use`/`tool_result` pair can be torn apart. Returns null when a partner
 * sits in the protected zone, is pinned, or is already blocked.
 */
function closureOf(idsAtIndex, indexById, items, kind, startIdx, protectFrom, removed, blocked) {
  const group = new Set([startIdx]);
  const queue = [startIdx];
  while (queue.length) {
    const current = queue.shift();
    for (const id of idsAtIndex[current]) {
      for (const other of indexById.get(id) || []) {
        if (group.has(other) || removed.has(other)) continue;
        if (other >= protectFrom || blocked.has(other)) return null;
        if (isPinned(items[other], kind)) return null;
        group.add(other);
        queue.push(other);
      }
    }
  }
  return group;
}

function runTrim({ body, budget, maxPasses }) {
  const container = resolveContainer(body);
  if (!container) return { changed: false, reason: "no-container" };
  if (!Number.isFinite(budget?.inputBudget)) return { changed: false, reason: "no-budget" };

  const { items, kind } = container;
  const totalItems = items.length;
  const charsPerToken = CONTEXT_GUARD_CONFIG.charsPerToken;
  const weights = items.map(item => textChars(item));
  const estBefore = Math.ceil(weights.reduce((sum, w) => sum + w, 0) / charsPerToken);
  // Anchor the chars/token guess to the count the provider reported, so the
  // number of dropped turns follows the provider's arithmetic rather than ours.
  const factor = Number.isFinite(budget.reportedInput) && estBefore > 0 ? budget.reportedInput / estBefore : 1;
  const survivorsTokens = removed => (weights.reduce((sum, w, i) => (removed.has(i) ? sum : sum + w), 0) / charsPerToken) * factor;

  const idsAtIndex = items.map(item => [...producesIds(item, kind), ...consumesIds(item, kind)]);
  const indexById = new Map();
  idsAtIndex.forEach((ids, i) => {
    for (const id of ids) {
      if (!indexById.has(id)) indexById.set(id, []);
      indexById.get(id).push(i);
    }
  });

  const protectFrom = protectedFrom(items, kind);
  const removed = new Set();
  const blocked = new Set();
  let groupsDropped = 0;
  let exhausted = false;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    if (survivorsTokens(removed) <= budget.inputBudget) break;
    let candidate = -1;
    for (let i = 0; i < protectFrom; i += 1) {
      if (removed.has(i) || blocked.has(i) || isPinned(items[i], kind)) continue;
      candidate = i;
      break;
    }
    if (candidate < 0) {
      exhausted = true;
      break;
    }
    const group = closureOf(idsAtIndex, indexById, items, kind, candidate, protectFrom, removed, blocked);
    if (!group) {
      blocked.add(candidate);
      continue;
    }
    for (const index of group) removed.add(index);
    groupsDropped += 1;
  }

  for (let i = items.length - 1; i >= 0; i -= 1) if (removed.has(i)) items.splice(i, 1);

  const firstMovingPart = items.findIndex(item => !isPinned(item, kind));
  if (firstMovingPart >= 0 && !isUserTurn(items[firstMovingPart], kind)) {
    items.splice(firstMovingPart, 0, noticeItem(kind));
  }

  const finalTokens = () => (items.reduce((sum, item) => sum + textChars(item), 0) / charsPerToken) * factor;

  // Input is the primary lever; the output ceiling only moves once there is
  // nothing left that may be cut.
  let outputClamped = false;
  if (exhausted && finalTokens() > budget.inputBudget) {
    outputClamped = clampOutputRequest(body, budget.max - Math.ceil(finalTokens()) - budget.margin);
  }
  const stillOver = finalTokens() > budget.inputBudget;

  return {
    changed: removed.size > 0 || outputClamped,
    reason: removed.size > 0 ? "trimmed" : outputClamped ? "output-clamped" : exhausted ? "nothing-droppable" : "already-fits",
    format: kind,
    itemsDropped: removed.size,
    groupsDropped,
    totalItems,
    keptItems: items.length,
    estBefore,
    estAfter: Math.ceil(finalTokens()),
    inputBudget: Math.round(budget.inputBudget),
    max: budget.max,
    margin: budget.margin,
    calibration: Number(factor.toFixed(3)),
    exhausted,
    outputClamped,
    stillOver,
  };
}

/**
 * Shrink a dispatch-format request body in place until it should fit the window
 * the provider reported. Mirrors the RTK contract: mutates the body, returns
 * stats, never throws — a guard that cannot prove itself safe leaves the
 * payload untouched and the caller surfaces the original error.
 */
export function planAndApplyTrim({ body, budget, maxPasses = CONTEXT_GUARD_CONFIG.maxTrimPasses }) {
  try {
    return runTrim({ body, budget, maxPasses });
  } catch (error) {
    return { changed: false, reason: "error", error: error?.message || String(error) };
  }
}

export function formatTrimLog(stats) {
  if (!stats) return "";
  if (!stats.changed) return `[CTXGUARD] refused trim (${stats.reason}${stats.error ? `: ${stats.error}` : ""})`;
  return `[CTXGUARD] max=${stats.max} budget=${stats.inputBudget}`
    + ` | dropped ${stats.itemsDropped}/${stats.totalItems} items in ${stats.groupsDropped} group(s)`
    + ` | est ${stats.estBefore}->${stats.estAfter} tok (x${stats.calibration})`
    + `${stats.outputClamped ? " | output clamped" : ""}${stats.stillOver ? " | STILL OVER" : ""}`;
}
