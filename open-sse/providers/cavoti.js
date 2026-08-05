// Cavoti exposes separate OpenAI-compatible surfaces for normal traffic,
// global acceleration, and image generation. Keep endpoint selection in one
// place so chat, media, catalog, usage, and video polling cannot drift.
export const CAVOTI_ENDPOINT_PROFILES = Object.freeze({
  default: Object.freeze({
    id: "default",
    label: "Default",
    baseUrl: "https://cavoti.com/v1",
  }),
  global: Object.freeze({
    id: "global",
    label: "Global acceleration",
    baseUrl: "https://cavoti.up.railway.app/v1",
  }),
  images: Object.freeze({
    id: "images",
    label: "Images only",
    baseUrl: "https://api.cavoti.com/v1/images/generations",
  }),
});

export const CAVOTI_ENDPOINT_PROFILE_OPTIONS = Object.freeze([
  CAVOTI_ENDPOINT_PROFILES.default,
  CAVOTI_ENDPOINT_PROFILES.global,
]);

export const CAVOTI_MODEL_PRICING_URL = "https://cavoti.com/api/v1/public/model-pricing";
export const CAVOTI_DEFAULT_MODEL_PATH = "/models";
export const CAVOTI_USAGE_PATH = "/usage";
export const CAVOTI_CHAT_PATH = "/chat/completions";
export const CAVOTI_VIDEO_PATH = "/videos";

export const CAVOTI_MODEL_CATALOG = Object.freeze([
  Object.freeze({ id: "codex-auto-review", name: "Codex Auto Review", kind: "llm" }),
  Object.freeze({ id: "gpt-5.4", name: "GPT-5.4", kind: "llm" }),
  Object.freeze({ id: "gpt-5.4-mini", name: "GPT-5.4 Mini", kind: "llm" }),
  Object.freeze({ id: "gpt-5.5", name: "GPT-5.5", kind: "llm" }),
  Object.freeze({ id: "gpt-5.6-luna", name: "GPT-5.6 Luna", kind: "llm" }),
  Object.freeze({ id: "gpt-5.6-sol", name: "GPT-5.6 Sol", kind: "llm" }),
  Object.freeze({ id: "gpt-5.6-terra", name: "GPT-5.6 Terra", kind: "llm" }),
  Object.freeze({ id: "gpt-image-2", name: "GPT Image 2", kind: "image", params: ["n", "size", "quality", "response_format"] }),
  Object.freeze({ id: "seedance-2.0", name: "Seedance 2.0", kind: "video", params: ["duration", "aspect_ratio", "resolution"] }),
  Object.freeze({ id: "seedance-2.0-fast", name: "Seedance 2.0 Fast", kind: "video", params: ["duration", "aspect_ratio", "resolution"] }),
  Object.freeze({ id: "seedance-2.0-mini", name: "Seedance 2.0 Mini", kind: "video", params: ["duration", "aspect_ratio", "resolution"] }),
]);

export const CAVOTI_MODEL_KIND_BY_ID = Object.freeze(
  Object.fromEntries(CAVOTI_MODEL_CATALOG.map((model) => [model.id, model.kind])),
);

export function normalizeCavotiEndpointProfile(profile) {
  return profile === "global" ? "global" : "default";
}

export function resolveCavotiEndpoint({
  endpointProfile,
  capability = "chat",
  path = "",
} = {}) {
  if (capability === "image") {
    return CAVOTI_ENDPOINT_PROFILES.images.baseUrl;
  }

  const profile = normalizeCavotiEndpointProfile(endpointProfile);
  const baseUrl = CAVOTI_ENDPOINT_PROFILES[profile].baseUrl;
  const suffix = path ? `/${String(path).replace(/^\/+/, "")}` : "";
  return `${baseUrl}${suffix}`;
}

export function resolveCavotiConnectionEndpoint(credentials, capability = "chat", path = "") {
  return resolveCavotiEndpoint({
    endpointProfile: credentials?.providerSpecificData?.endpointProfile,
    capability,
    path,
  });
}
