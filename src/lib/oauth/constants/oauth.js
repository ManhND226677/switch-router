/**
 * OAuth Configuration Constants — static data lives in registry, re-exported here for consumers.
 */
import { platform, arch } from "os";
import { ANTIGRAVITY_OAUTH_CLIENT } from "open-sse/providers/shared.js";
import { PROVIDER_OAUTH, PROVIDERS as REGISTRY_PROVIDERS } from "open-sse/providers/index.js";

/**
 * Get the platform enum value based on the current OS.
 * Matches Antigravity binary's ClientMetadata.Platform enum.
 */
function getOAuthPlatformEnum() {
  const os = platform();
  const architecture = arch();
  if (os === "darwin") return architecture === "arm64" ? 2 : 1;
  if (os === "linux") return architecture === "arm64" ? 4 : 3;
  if (os === "win32") return 5;
  return 0;
}

// Claude OAuth Configuration (Authorization Code Flow with PKCE)
export const CLAUDE_CONFIG = { ...PROVIDER_OAUTH["claude"] };

// Codex (OpenAI) OAuth Configuration (Authorization Code Flow with PKCE)
export const CODEX_CONFIG = { ...PROVIDER_OAUTH["codex"] };

// Qwen OAuth Configuration (Device Code Flow with PKCE)
export const QWEN_CONFIG = { ...PROVIDER_OAUTH["qwen"] };

// Antigravity OAuth Configuration (Standard OAuth2 with Google)
// clientId/clientSecret from ANTIGRAVITY_OAUTH_CLIENT (shared.js) — not stored in registry
// loadCodeAssistClientMetadata is dynamic (runtime platform detection)
export const ANTIGRAVITY_CONFIG = {
  ...ANTIGRAVITY_OAUTH_CLIENT,
  ...PROVIDER_OAUTH["antigravity"],
  loadCodeAssistClientMetadata: JSON.stringify({ ideType: 9, platform: getOAuthPlatformEnum(), pluginType: 2 }),
};

/**
 * Get client metadata using numeric enum values for API calls.
 * @returns {{ ideType: number, platform: number, pluginType: number }}
 */
export function getOAuthClientMetadata() {
  return { ideType: 9, platform: getOAuthPlatformEnum(), pluginType: 2 };
}

// GitHub Copilot OAuth Configuration (Device Code Flow)
export const GITHUB_CONFIG = { ...PROVIDER_OAUTH["github"] };

// Kimi Coding OAuth Configuration (Device Code Flow)
// clientId uses env override — dynamic, not stored in registry
export const KIMI_CODING_CONFIG = {
  ...PROVIDER_OAUTH["kimi-coding"],
  clientId: process.env.KIMI_CODING_OAUTH_CLIENT_ID || REGISTRY_PROVIDERS["kimi-coding"]?.clientId,
};

// KiloCode OAuth Configuration (Custom Device Auth Flow)
export const KILOCODE_CONFIG = { ...PROVIDER_OAUTH["kilocode"] };

// Grok CLI / Grok Build OAuth Configuration (Device Code Flow)
// Endpoint: cli-chat-proxy.grok.com — device-code flow with Grok Build scopes
export const GROK_CLI_CONFIG = { ...PROVIDER_OAUTH["grok-cli"] };

// OAuth timeout (5 minutes)
export const OAUTH_TIMEOUT = 300000;

// Provider list
export const PROVIDERS = {
  CLAUDE: "claude",
  CODEX: "codex",
  QWEN: "qwen",
  ANTIGRAVITY: "antigravity",
  OPENAI: "openai",
  GITHUB: "github",
  KIMI_CODING: "kimi-coding",
  KILOCODE: "kilocode",
  GROK_CLI: "grok-cli",
};
