// ViLao AI (vilao.ai) — endpoint resolution in one place.
//
// ViLao is a P2P marketplace. Its public docs mask the gateway as
// `https://<endpoint>/v1` and tell users to copy the endpoint URL from their own
// LLM API Keys page, so the host is NOT guaranteed to be identical for every
// key. `https://api.vilao.ai/v1` is the default gateway (verified 2026-08-04:
// GET /v1/health → {"status":"healthy"}; an invalid key on /v1/models → 401
// INVALID_API_KEY in OpenAI error shape). A per-connection override wins over it.
//
// Keep chat, models catalog, embeddings, and validation reading from here so the
// four call sites cannot drift.

import { validateSafeBaseUrl } from "../utils/safeBaseUrl.js";

export const VILAO_DEFAULT_ORIGIN = "https://api.vilao.ai";
export const VILAO_DEFAULT_BASE_URL = `${VILAO_DEFAULT_ORIGIN}/v1`;

export const VILAO_MODELS_PATH = "/models";
export const VILAO_CHAT_PATH = "/chat/completions";
export const VILAO_EMBEDDINGS_PATH = "/embeddings";

// Paths a user might paste along with their endpoint; stripped before re-adding /v1.
const KNOWN_ENDPOINT_PATHS = /\/(chat\/completions|completions|embeddings|models|responses|messages)$/;

// Normalize a user-supplied ViLao endpoint to a bare `<origin>/v1` base.
// Tolerates: trailing slashes, a missing scheme, a pasted `/chat/completions`
// path, and a missing `/v1` suffix. Falls back to the default gateway when the
// value is empty, unparseable, or points at a private/loopback host.
export function normalizeVilaoBaseUrl(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return VILAO_DEFAULT_BASE_URL;

  const check = validateSafeBaseUrl(value);
  if (!check.ok) return VILAO_DEFAULT_BASE_URL;
  const url = check.url;

  let pathname = url.pathname.replace(/\/+$/, "").replace(KNOWN_ENDPOINT_PATHS, "");
  if (!/\/v\d+$/.test(pathname)) pathname = `${pathname}/v1`;

  return `${url.origin}${pathname}`;
}

// Resolve a concrete ViLao URL for a capability, honouring a per-key override.
export function resolveVilaoEndpoint({ baseUrl, path = "" } = {}) {
  const base = normalizeVilaoBaseUrl(baseUrl);
  const suffix = path ? `/${String(path).replace(/^\/+/, "")}` : "";
  return `${base}${suffix}`;
}

export function resolveVilaoConnectionEndpoint(credentials, path = "") {
  return resolveVilaoEndpoint({
    baseUrl: credentials?.providerSpecificData?.baseUrl,
    path,
  });
}

export function getVilaoModelsUrl(baseUrl) {
  return resolveVilaoEndpoint({ baseUrl, path: VILAO_MODELS_PATH });
}
