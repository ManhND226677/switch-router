// Tunables for the context guard. Deliberately small: every number here is a
// guess about someone else's tokenizer, so it is only ever used to size a
// *retry* of a request the upstream already rejected.
export const CONTEXT_GUARD_CONFIG = {
  // chars per token. 3 (not the 4 used for billing estimates) because we would
  // rather over-trim one turn than burn a second 90s prefill on a miss.
  charsPerToken: 3,
  // Floor for the safety margin, in tokens.
  minMarginTokens: 1024,
  // Margin as a percentage of the window, applied on top of the floor.
  defaultMarginPct: 5,
  // Each pass drops one or more whole turn groups. Bounded so a pathological
  // body cannot spin.
  maxTrimPasses: 8,
};
