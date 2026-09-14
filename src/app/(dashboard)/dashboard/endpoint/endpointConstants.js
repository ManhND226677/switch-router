export const CAVEMAN_LEVELS = [
  { id: "lite", label: "Lite", desc: "Drop filler, keep grammar" },
  { id: "full", label: "Full", desc: "Drop articles, fragments OK" },
  { id: "ultra", label: "Ultra", desc: "Telegraphic, max compression" },
];

export const PONYTAIL_LEVELS = [
  { id: "lite", label: "Lite", desc: "Build asked, name lazier option" },
  { id: "full", label: "Full", desc: "Ladder enforced: stdlib/native first" },
  { id: "ultra", label: "Ultra", desc: "YAGNI extremist, deletion first" },
];

/**
 * Every base URL the gateway actually serves.
 *
 * Each entry mirrors a rewrite declared in next.config.mjs (or, for the Office
 * group, a real route under src/app/office/v1). Keep this list in sync with
 * next.config.mjs `rewrites()` — it is documentation the user can copy, so a
 * stale entry is worse than a missing one.
 */
export const ENDPOINT_GROUPS = [
  {
    id: "v1",
    label: "OpenAI",
    badge: "OAI",
    tone: "accent",
    path: "/v1",
    icon: "hub",
    desc: "One surface — OpenAI-compatible, Anthropic Messages and Responses API (Codex CLI)",
    routes: [
      "POST /v1/chat/completions",
      "POST /v1/responses",
      "GET  /v1/models",
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    badge: "CLAUDE",
    tone: "accent",
    path: "/v1/messages",
    icon: "forum",
    desc: "Anthropic Messages format — same /v1 surface; point Claude Code/SDK at the base WITHOUT /v1",
    routes: [
      "POST /v1/messages",
      "POST /v1/messages/count_tokens",
    ],
  },
  {
    id: "office",
    label: "Claude for M365",
    badge: "M365",
    tone: "office",
    path: "/office/v1",
    icon: "description",
    desc: "Isolated Office gateway — always requires its own API key",
    requiresOfficeGateway: true,
    routes: [
      "GET  /office/v1/models",
      "POST /office/v1/messages",
    ],
  },
];

// NOTE: SNIPPET_TABS + buildSnippet (quick-start snippet builder) were removed
// along with the QuickStartCard in the overview-only dashboard refactor —
// Base URLs is the single source of client connection info now.

