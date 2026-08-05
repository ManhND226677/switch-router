// Switch-Router Agent Skills catalog.
// Canonical documents live in /skills/switch-router-*; the 9router-* ids are
// retained as local compatibility aliases for existing agents.

export const SWITCH_ROUTER_BASE_URL = "http://127.0.0.1:28701";
export const SKILL_API_PATH = "/api/skills";

const SKILL_DEFINITIONS = [
  {
    id: "switch-router",
    aliases: ["9router"],
    name: "Switch-Router (Entry)",
    description: "Local setup, optional API key, model discovery, combos, fallback, and capability index.",
    endpoint: null,
    icon: "hub",
    isEntry: true,
    sourceFile: "skills/switch-router/SKILL.md",
  },
  {
    id: "switch-router-chat",
    aliases: ["9router-chat"],
    name: "Chat",
    description: "OpenAI and Anthropic chat/code generation with format translation and streaming.",
    endpoint: "/v1/chat/completions",
    icon: "chat",
    sourceFile: "skills/switch-router-chat/SKILL.md",
  },
  {
    id: "switch-router-image",
    aliases: ["9router-image"],
    name: "Image Generation",
    description: "Image generation through the configured image provider and model registry.",
    endpoint: "/v1/images/generations",
    icon: "image",
    sourceFile: "skills/switch-router-image/SKILL.md",
  },
  {
    id: "switch-router-video",
    aliases: ["9router-video"],
    name: "Video Generation",
    description: "Asynchronous video generation, editing, extension, and status polling.",
    endpoint: "/v1/videos/generations",
    icon: "movie",
    sourceFile: "skills/switch-router-video/SKILL.md",
  },
  {
    id: "switch-router-tts",
    aliases: ["9router-tts"],
    name: "Text-to-Speech",
    description: "Generate speech from text through the configured voice providers.",
    endpoint: "/v1/audio/speech",
    icon: "record_voice_over",
    sourceFile: "skills/switch-router-tts/SKILL.md",
  },
  {
    id: "switch-router-stt",
    aliases: ["9router-stt"],
    name: "Speech-to-Text",
    description: "Transcribe audio with the configured OpenAI-compatible speech models.",
    endpoint: "/v1/audio/transcriptions",
    icon: "mic",
    sourceFile: "skills/switch-router-stt/SKILL.md",
  },
  {
    id: "switch-router-embeddings",
    aliases: ["9router-embeddings"],
    name: "Embeddings",
    description: "Create vectors for RAG, semantic search, and similarity workflows.",
    endpoint: "/v1/embeddings",
    icon: "scatter_plot",
    sourceFile: "skills/switch-router-embeddings/SKILL.md",
  },
  {
    id: "switch-router-web-search",
    aliases: ["9router-web-search"],
    name: "Web Search",
    description: "Search through the configured search provider with normalized results.",
    endpoint: "/v1/search",
    icon: "search",
    sourceFile: "skills/switch-router-web-search/SKILL.md",
  },
  {
    id: "switch-router-web-fetch",
    aliases: ["9router-web-fetch"],
    name: "Web Fetch",
    description: "Extract a public URL as Markdown, text, or HTML through a configured provider.",
    endpoint: "/v1/web/fetch",
    icon: "language",
    sourceFile: "skills/switch-router-web-fetch/SKILL.md",
  },
];

export const SKILLS = Object.freeze(SKILL_DEFINITIONS.map((skill) => Object.freeze({ ...skill })));

const SKILL_BY_ID = new Map(
  SKILLS.flatMap((skill) => [
    [skill.id, skill],
    ...(skill.aliases || []).map((alias) => [alias, skill]),
  ]),
);

export function getSkillDefinition(id) {
  return SKILL_BY_ID.get(String(id || "").trim()) || null;
}

export function getSkillRawUrl(id) {
  return `${SKILL_API_PATH}/${encodeURIComponent(id)}`;
}

// Kept as an export for callers that used the old GitHub/blob naming.
export function getSkillBlobUrl(id) {
  return getSkillRawUrl(id);
}

export function getSkillAbsoluteUrl(id, origin = SWITCH_ROUTER_BASE_URL) {
  return `${String(origin).replace(/\/$/, "")}${getSkillRawUrl(id)}`;
}

export function getSkillInstruction(id, origin = SWITCH_ROUTER_BASE_URL) {
  return `Read this skill and use it: ${getSkillAbsoluteUrl(id, origin)}`;
}
