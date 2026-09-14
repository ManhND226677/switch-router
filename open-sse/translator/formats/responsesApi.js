import { ROLE, RESPONSES_ITEM } from "../schema/index.js";

/**
 * Normalize Responses API input to array format.
 * Accepts string or array, returns array of message items.
 * An empty array is treated like an empty string — providers require at least one user
 * message, so we inject a placeholder rather than forwarding an empty messages[].
 * @param {string|Array} input - raw input from Responses API body
 * @returns {Array|null} normalized array or null if invalid
 */
export function normalizeResponsesInput(input) {
  if (typeof input === "string") {
    const text = input.trim() === "" ? "..." : input;
    return [{ type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text }] }];
  }
  if (Array.isArray(input)) {
    // Empty input[] would produce messages:[] which all providers reject (#389)
    if (input.length === 0) {
      return [{ type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: "..." }] }];
    }
    return input;
  }
  return null;
}
