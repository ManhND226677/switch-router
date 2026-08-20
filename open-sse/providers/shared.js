import { platform, arch } from "os";

// === OS/Arch helpers (Stainless fingerprint) ===
export function mapStainlessOs() {
  switch (platform()) {
    case "darwin": return "MacOS";
    case "win32": return "Windows";
    case "linux": return "Linux";
    case "freebsd": return "FreeBSD";
    default: return `Other::${platform()}`;
  }
}

export function mapStainlessArch() {
  switch (arch()) {
    case "x64": return "x64";
    case "arm64": return "arm64";
    case "ia32": return "x86";
    default: return `other::${arch()}`;
  }
}

// Anthropic API version (single source — reused across claude-format providers/executors)
export const ANTHROPIC_API_VERSION = "2023-06-01";

// Shared Claude-compatible API headers (reused across claude-format providers)
export const CLAUDE_API_HEADERS = {
  "Anthropic-Version": ANTHROPIC_API_VERSION,
  "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
};

// Full Claude CLI fingerprint — required by providers that gate on client identity (e.g. agentrouter)
export const CLAUDE_CLI_SPOOF_HEADERS = {
  "Anthropic-Version": ANTHROPIC_API_VERSION,
  "Anthropic-Beta": "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,advanced-tool-use-2025-11-20,effort-2025-11-24,structured-outputs-2025-12-15,fast-mode-2026-02-01,redact-thinking-2026-02-12,token-efficient-tools-2026-03-28",
  "Anthropic-Dangerous-Direct-Browser-Access": "true",
  "User-Agent": "claude-cli/2.1.92 (external, sdk-cli)",
  "X-App": "cli",
  "X-Stainless-Helper-Method": "stream",
  "X-Stainless-Retry-Count": "0",
  "X-Stainless-Runtime-Version": "v24.14.0",
  "X-Stainless-Package-Version": "0.80.0",
  "X-Stainless-Runtime": "node",
  "X-Stainless-Lang": "js",
  "X-Stainless-Arch": mapStainlessArch(),
  "X-Stainless-Os": mapStainlessOs(),
  "X-Stainless-Timeout": "600"
};

// Shared baseUrls
export const KIMI_CODING_BASE_URL = "https://api.kimi.com/coding/v1/messages";

// Default base for dynamic compat providers (openai-compatible-* / anthropic-compatible-*) when user gives no baseUrl
export const OPENAI_COMPAT_BASE = "https://api.openai.com/v1";
export const ANTHROPIC_COMPAT_BASE = "https://api.anthropic.com/v1";

// Official Antigravity IDE Desktop fingerprint.
// Captured from installed Antigravity IDE 2.5.5 (Windows) product.json + main.js:
//   userAgent() {
//     const name = isGoogleInternal ? "jetski" : "antigravity";
//     return `${name}/${ideVersion} ${platform}/${arch}`
//   }
// where platform: win32→windows, else process.platform; arch: x64→amd64, ia32→386.
// Format NO LONGER includes the "/ide/" segment used by 2.1.x.
// Keep a stable darwin/arm64 profile (same approach as before) unless host is Windows.
export const ANTIGRAVITY_IDE_VERSION = "2.5.5";
// IDE (2.5.5 main.js) defines:
//   daily  = https://daily-cloudcode-pa.googleapis.com
//   prod   = https://cloudcode-pa.googleapis.com
// Measured 2026-08-14 with a free-tier account that works inside the IDE:
//   generateContent on prod  → 429 RESOURCE_EXHAUSTED
//   generateContent on daily → 200 (same token/project/model/body)
// Chat/generate must prefer the daily host. loadCodeAssist/onboardUser/models
// can stay on prod (those endpoints already return 200 there).
export const ANTIGRAVITY_IDE_BASE_URL = "https://daily-cloudcode-pa.googleapis.com";
export const ANTIGRAVITY_IDE_PROD_BASE_URL = "https://cloudcode-pa.googleapis.com";
function antigravityIdePlatform() {
  // Match IDE: win32 → "windows"; leave darwin/linux as-is.
  return process.platform === "win32" ? "windows" : process.platform;
}
function antigravityIdeArch() {
  switch (process.arch) {
    case "x64": return "amd64";
    case "ia32": return "386";
    default: return process.arch; // arm64 stays arm64
  }
}
export const ANTIGRAVITY_IDE_USER_AGENT =
  `antigravity/${ANTIGRAVITY_IDE_VERSION} ${antigravityIdePlatform()}/${antigravityIdeArch()}`;

// Antigravity OAuth client credentials (public CLI client — duplicated in usage.js + src/lib/oauth)
export const ANTIGRAVITY_OAUTH_CLIENT = {
  clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
  clientSecret: "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"
};

// Gemini (Google) OAuth client credentials (public CLI client — shared by gemini, gemini-cli, src/lib/oauth)
export const GOOGLE_OAUTH_CLIENT = {
  clientId: "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
  clientSecret: "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"
};
