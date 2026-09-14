// Shape layer for the context guard: where the conversation lives in a
// provider-format body, what each item weighs, and which tool ids bind items
// together. Pure — nothing here decides what to drop.

const PINNED_ROLES = new Set(["system", "developer", "instructions"]);
const PINNED_TYPES = new Set(["reasoning", "item", "instruction", "system"]);
const USER_ROLES = new Set(["user"]);

/**
 * Locate the conversation array in a dispatch-format request body.
 * @returns {null | { items: object[], kind: "messages" | "input" | "contents" }}
 *   `items` is the live array reference, so callers splice in place.
 */
export function resolveContainer(body) {
  if (!body || typeof body !== "object") return null;
  if (Array.isArray(body.messages)) return { items: body.messages, kind: "messages" };
  if (Array.isArray(body.input)) return { items: body.input, kind: "input" };
  if (Array.isArray(body.contents)) return { items: body.contents, kind: "contents" };
  if (Array.isArray(body.request?.contents)) return { items: body.request.contents, kind: "contents" };
  return null;
}

function blocksOf(item) {
  return Array.isArray(item?.content) ? item.content
    : Array.isArray(item?.parts) ? item.parts
    : Array.isArray(item?.output) && typeof item.output[0] === "object" ? item.output
    : [];
}

export function roleOf(item, kind) {
  if (!item || typeof item !== "object") return "";
  const role = typeof item.role === "string" ? item.role : "";
  if (kind === "input") {
    // Responses API carries the actor in `type`; only `message` also has a role.
    if (item.type === "message" || role) return role || "user";
    return item.type || "other";
  }
  return role;
}

/** Items the guard must never remove, whatever their size. */
export function isPinned(item, kind) {
  if (!item || typeof item !== "object") return true;
  const role = roleOf(item, kind);
  if (PINNED_ROLES.has(role)) return true;
  if (kind === "input" && PINNED_TYPES.has(item.type)) return true;
  return false;
}

/** Start of the turn the model is answering right now — everything from here on stays. */
export function isUserTurn(item, kind) {
  return USER_ROLES.has(roleOf(item, kind));
}

function callIds(block, kind) {
  // Returns { produces: string[], consumes: string[] } contributed by one block.
  const produces = [];
  const consumes = [];
  if (!block || typeof block !== "object") return { produces, consumes };
  const type = block.type;
  if (kind === "messages") {
    if (type === "tool_use" && block.id) produces.push(`t:${block.id}`);
    if (type === "tool_result" && block.tool_use_id) consumes.push(`t:${block.tool_use_id}`);
  } else if (kind === "input") {
    if (type === "function_call" && block.call_id) produces.push(`c:${block.call_id}`);
    if (type === "function_call_output" && block.call_id) consumes.push(`c:${block.call_id}`);
  } else if (kind === "contents") {
    const call = block.functionCall;
    const response = block.functionResponse;
    if (call) produces.push(`f:${call.id || call.name}`);
    if (response) consumes.push(`f:${response.id || response.name}`);
  }
  return { produces, consumes };
}

/** Tool-call ids this item creates. */
export function producesIds(item, kind) {
  const out = [];
  if (!item || typeof item !== "object") return out;
  if (kind === "messages" && Array.isArray(item.tool_calls)) {
    for (const call of item.tool_calls) if (call?.id) out.push(`t:${call.id}`);
  }
  if (kind === "input" && item.type === "function_call" && item.call_id) out.push(`c:${item.call_id}`);
  if (kind === "contents" && Array.isArray(item.parts)) {
    for (const part of item.parts) if (part?.functionCall) out.push(`f:${part.functionCall.id || part.functionCall.name}`);
  }
  for (const block of blocksOf(item)) out.push(...callIds(block, kind).produces);
  return out;
}

/** Tool-call ids this item answers. */
export function consumesIds(item, kind) {
  const out = [];
  if (!item || typeof item !== "object") return out;
  if (kind === "messages") {
    if (item.role === "tool" && item.tool_call_id) out.push(`t:${item.tool_call_id}`);
    if (item.role === "assistant" && Array.isArray(item.tool_calls)) return out; // calls, not answers
  }
  if (kind === "input" && item.type === "function_call_output" && item.call_id) out.push(`c:${item.call_id}`);
  if (kind === "contents" && Array.isArray(item.parts)) {
    for (const part of item.parts) if (part?.functionResponse) out.push(`f:${part.functionResponse.id || part.functionResponse.name}`);
  }
  for (const block of blocksOf(item)) out.push(...callIds(block, kind).consumes);
  return out;
}

/**
 * Count the characters of string leaves only. Key names and JSON syntax are
 * deliberately excluded — they inflated the older `JSON.stringify().length / 4`
 * estimator by roughly a third on tool-heavy bodies.
 */
export function textChars(value, depth = 0) {
  if (depth > 12 || value == null) return 0;
  if (typeof value === "string") return value.length;
  if (typeof value === "number" || typeof value === "boolean") return 8;
  if (Array.isArray(value)) {
    let total = 0;
    for (const entry of value) total += textChars(entry, depth + 1);
    return total;
  }
  if (typeof value === "object") {
    let total = 0;
    for (const nested of Object.values(value)) total += textChars(nested, depth + 1);
    return total;
  }
  return 0;
}
