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
    id: "openai",
    label: "OpenAI",
    badge: "OAI",
    tone: "accent",
    path: "/v1",
    icon: "hub",
    desc: "chat/completions, messages, responses",
    routes: [
      "POST /v1/chat/completions",
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
    desc: "Anthropic Messages format — Claude Code and Anthropic SDKs",
    routes: [
      "POST /v1/messages",
      "POST /v1/messages/count_tokens",
    ],
  },
  {
    id: "gemini",
    label: "Gemini",
    badge: "GEM",
    tone: "accent",
    path: "/v1beta",
    icon: "auto_awesome",
    desc: "Gemini native generateContent surface",
    routes: [
      "POST /v1beta/models/{model}:generateContent",
      "GET  /v1beta/models",
    ],
  },
  {
    id: "codex",
    label: "Codex",
    badge: "CDX",
    tone: "accent",
    path: "/codex",
    icon: "terminal",
    desc: "Responses API for Codex-style clients",
    aliases: ["/responses"],
    routes: [
      "POST /codex",
      "POST /responses",
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
    excludeFromBaseUrls: true,
    routes: [
      "GET  /office/v1/models",
      "POST /office/v1/messages",
    ],
  },
  {
    id: "compat",
    label: "Doubled /v1",
    badge: "COMPAT",
    tone: "muted",
    path: "/v1/v1",
    icon: "shield",
    desc: "Safety net for clients that append /v1 to a base URL that already ends in /v1",
    routes: ["ANY /v1/v1/*"],
  },
];

/** Client snippet tabs rendered by the quick-start card. */
export const SNIPPET_TABS = [
  { value: "curl", label: "curl", icon: "terminal" },
  { value: "openai", label: "OpenAI SDK", icon: "code" },
  { value: "anthropic", label: "Anthropic SDK", icon: "code" },
  { value: "env", label: "Env vars", icon: "settings" },
];

const KEY_PLACEHOLDER = "<YOUR_API_KEY>";

/**
 * Builds a copy-pasteable client snippet for the given tab.
 * `apiKey` is optional — the placeholder is used until the user explicitly
 * chooses a key, so the page never leaks a real key into a snippet by default.
 */
export function buildSnippet(tab, origin, apiKey) {
  const key = apiKey || KEY_PLACEHOLDER;
  const base = `${origin}/v1`;

  if (tab === "curl") {
    return [
      `curl ${base}/chat/completions \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "Authorization: Bearer ${key}" \\`,
      `  -d '{`,
      `    "model": "gpt-5.5",`,
      `    "messages": [{ "role": "user", "content": "hi" }]`,
      `  }'`,
    ].join("\n");
  }

  if (tab === "openai") {
    return [
      `from openai import OpenAI`,
      ``,
      `client = OpenAI(`,
      `    base_url="${base}",`,
      `    api_key="${key}",`,
      `)`,
      ``,
      `response = client.chat.completions.create(`,
      `    model="gpt-5.5",`,
      `    messages=[{"role": "user", "content": "hi"}],`,
      `)`,
      `print(response.choices[0].message.content)`,
    ].join("\n");
  }

  if (tab === "anthropic") {
    return [
      `from anthropic import Anthropic`,
      ``,
      `client = Anthropic(`,
      `    base_url="${origin}",`,
      `    api_key="${key}",`,
      `)`,
      ``,
      `message = client.messages.create(`,
      `    model="claude-sonnet-4-20250514",`,
      `    max_tokens=256,`,
      `    messages=[{"role": "user", "content": "hi"}],`,
      `)`,
      `print(message.content[0].text)`,
    ].join("\n");
  }

  return [
    `# OpenAI-compatible clients`,
    `OPENAI_BASE_URL=${base}`,
    `OPENAI_API_KEY=${key}`,
    ``,
    `# Claude Code / Anthropic SDKs`,
    `ANTHROPIC_BASE_URL=${origin}`,
    `ANTHROPIC_AUTH_TOKEN=${key}`,
  ].join("\n");
}
