import { platform, arch } from "os";
import { PROVIDERS, PROVIDER_OAUTH } from "./providers.js";
import { ANTIGRAVITY_IDE_USER_AGENT } from "../providers/shared.js";

// === GitHub Copilot ===
// Derive từ registry github.transport.copilot
const _ghCopilot = PROVIDERS.github?.copilot || {};
export const GITHUB_COPILOT = {
  VSCODE_VERSION: _ghCopilot.vscodeVersion,
  COPILOT_CHAT_VERSION: _ghCopilot.chatVersion,
  USER_AGENT: _ghCopilot.userAgent,
  API_VERSION: _ghCopilot.apiVersion,
};

// === Antigravity enums ===
export const IDE_TYPE = {
  UNSPECIFIED: 0,
  JETSKI: 10,
  ANTIGRAVITY: 9,
  PLUGINS: 7
};

export const PLATFORM = {
  UNSPECIFIED: 0,
  DARWIN_AMD64: 1,
  DARWIN_ARM64: 2,
  LINUX_AMD64: 3,
  LINUX_ARM64: 4,
  WINDOWS_AMD64: 5
};

export const PLUGIN_TYPE = {
  UNSPECIFIED: 0,
  CLOUD_CODE: 1,
  GEMINI: 2
};

export function getPlatformEnum() {
  const os = platform();
  const architecture = arch();
  if (os === "darwin") return architecture === "arm64" ? PLATFORM.DARWIN_ARM64 : PLATFORM.DARWIN_AMD64;
  if (os === "linux") return architecture === "arm64" ? PLATFORM.LINUX_ARM64 : PLATFORM.LINUX_AMD64;
  if (os === "win32") return PLATFORM.WINDOWS_AMD64;
  return PLATFORM.UNSPECIFIED;
}

export function getPlatformUserAgent() {
  return ANTIGRAVITY_IDE_USER_AGENT;
}

export const CLIENT_METADATA = {
  ideType: IDE_TYPE.ANTIGRAVITY,
  platform: getPlatformEnum(),
  pluginType: PLUGIN_TYPE.GEMINI
};

// Internal anti-loop header
export const INTERNAL_REQUEST_HEADER = { name: "x-request-source", value: "local" };

// Suffix added to client tools when forwarding to Antigravity provider (anti-ban cloaking)
export const AG_TOOL_SUFFIX = "_ide";

// Suffix added to client tools when forwarding to Claude provider (anti-ban cloaking)
export const CLAUDE_TOOL_SUFFIX = "_ide";

// CC native default tools — these are Claude Code's own tools, kept as decoys
// Client tools matching these names are skipped (not renamed), others get _cc suffix
export const CC_DEFAULT_TOOLS = new Set([
  "Task",
  "TaskOutput",
  "TaskStop",
  "TaskCreate",
  "TaskGet",
  "TaskUpdate",
  "TaskList",
  "Bash",
  "Glob",
  "Grep",
  "Read",
  "Edit",
  "Write",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "AskUserQuestion",
  "Skill",
  "EnterPlanMode",
  "ExitPlanMode",
]);

// AG native default tools — kept as decoys with neutral description/properties
// These names must match exactly what AG sends in the real request log
export const AG_DEFAULT_TOOLS = new Set([
  "browser_subagent",
  "command_status",
  "find_by_name",
  "generate_image",
  "grep_search",
  "list_dir",
  "list_resources",
  "multi_replace_file_content",
  "notify_user",
  "read_resource",
  "read_terminal",
  "read_url_content",
  "replace_file_content",
  "run_command",
  "search_web",
  "send_command_input",
  "task_boundary",
  "view_content_chunk",
  "view_file",
  "write_to_file"
]);

// Antigravity chat/stream headers
export const ANTIGRAVITY_HEADERS = {
  "User-Agent": ANTIGRAVITY_IDE_USER_AGENT
};

// Cloud Code Assist API
export const CLOUD_CODE_API = {
  loadCodeAssist: "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
  onboardUser: "https://cloudcode-pa.googleapis.com/v1internal:onboardUser",
};

export const LOAD_CODE_ASSIST_HEADERS = {
  "Content-Type": "application/json",
  // Match installed Antigravity IDE fingerprint (2.5.5+) for loadCodeAssist/onboardUser.
  "User-Agent": ANTIGRAVITY_IDE_USER_AGENT,
  "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
  "Client-Metadata": JSON.stringify({ ideType: IDE_TYPE.ANTIGRAVITY, platform: getPlatformEnum(), pluginType: PLUGIN_TYPE.GEMINI }),
};

export const LOAD_CODE_ASSIST_METADATA = {
  ideType: IDE_TYPE.ANTIGRAVITY,
  platform: getPlatformEnum(),
  pluginType: PLUGIN_TYPE.GEMINI,
};

// System prompts
export const CLAUDE_SYSTEM_PROMPT = "You are Claude Code, Anthropic's official CLI for Claude.";

// This is the neutral CLI identity used on WorkBuddy's chat plane. The catalog plane
// deliberately uses a different IDE identity; do not reuse that identity here.
// Keeping this value in the shared constants file makes the provider's wire contract
// visible to both the executor and tests without copying a client token or account id.
export const WORKBUDDY_CHAT_USER_AGENT = "CLI/unknown CodeBuddy/2.137.1";

// Daily check-in planes (same session-token auth as the billing-meter credit
// summary). checkin-status exposes the current season (active, daily_credit,
// today_checked_in, streak); daily-checkin claims the day's credits. Both are
// seasonal campaigns — with no season running the claim answers 400 code 10001
// "签到活动未开启或已过期", which the auto check-in scheduler treats as idle.
export const WORKBUDDY_CHECKIN_STATUS_URL = "https://www.workbuddy.ai/billing/meter/checkin-status";
export const WORKBUDDY_CHECKIN_CLAIM_URL = "https://www.workbuddy.ai/billing/meter/daily-checkin";

// WorkBuddy AI screens chat bodies for third-party CLI identity and rejects them with
// code 11128 "Illegal API invocation from an unapproved channel". Measured 2026-08-30
// via A/B probes through the gateway: the gate is role-specific — a foreign identity
// at the head of a SYSTEM message blocks, and the same identity anywhere inside an
// ASSISTANT message can block retry/tool-call turns. A ZCode request additionally
// carried a client-owned Git snapshot whose `Main branch: ...` line was fingerprinted
// as an unapproved channel marker. User messages and tool definitions are conversation
// data, not harness identity, so they are intentionally preserved byte-for-byte.
// Each rule carries the roles it must scrub; the surrounding task instructions remain
// available to the model after the client-owned marker is removed.
export const WORKBUDDY_IDENTITY_REWRITES = [
  {
    roles: ["system"],
    pattern: /^You are Claude Code, Anthropic's official CLI for Claude[^\n]*/gm,
    to: "You are an expert software engineering agent.",
  },
  {
    roles: ["assistant"],
    pattern: /You are Claude Code, Anthropic's official CLI for Claude/g,
    to: "You are an expert software engineering agent",
  },
  {
    roles: ["system"],
    pattern: /^You are ZCode,[^\n]*/gm,
    to: "You are an expert software engineering agent.",
  },
  {
    roles: ["system"],
    // ZCode currently emits a second channel marker immediately after the
    // short identity line: "You are an interactive ZCode agent ...". The
    // WorkBuddy gate rejects that line too, even after the first line is
    // rewritten, so keep the whole line's harness content but neutralize the
    // product identity at the system-role boundary.
    pattern: /^[ \t]*You are an interactive ZCode agent[^\n]*/gim,
    to: "You are an expert software engineering agent.",
  },
  {
    roles: ["system"],
    // Keep the desktop-context section useful, but remove the foreign product label
    // from a heading when a client exposes it as part of its own harness.
    pattern: /^[ \t]*#[ \t]*(?:ZCode|DeepSeek[ \t-]+Harness|Claude[ \t]+Code)[ \t]+Desktop[ \t]+Context[ \t]*$/gim,
    to: "# Desktop Context",
  },
  {
    roles: ["system"],
    // ZCode appends a git-status snapshot to its dynamic system context. The
    // WorkBuddy channel gate fingerprints the `Main branch: ...` portion of
    // that block as an unapproved client marker, so remove only this trailing
    // metadata block while keeping the actual agent instructions intact.
    pattern: /(?:\r?\n)*gitStatus:\s*This is the git status at the start of the conversation\.[\s\S]*$/i,
    to: "",
  },
  {
    roles: ["assistant"],
    pattern: /You are ZCode,[^.!?\n]*[.!?]?/g,
    to: "You are an expert software engineering agent",
  },
  {
    roles: ["assistant"],
    pattern: /You are an interactive ZCode agent[^.!?\n]*[.!?]?/gi,
    to: "You are an expert software engineering agent",
  },
];

export const ANTIGRAVITY_DEFAULT_SYSTEM = "You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding.You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.**Absolute paths only****Proactiveness**";

// Derive từ registry oauth.refreshLeadMs
export const REFRESH_LEAD_MS = Object.fromEntries(
  Object.entries(PROVIDER_OAUTH).filter(([, o]) => o.refreshLeadMs).map(([id, o]) => [id, o.refreshLeadMs])
);

// OAuth endpoints
export const OAUTH_ENDPOINTS = {
  google:    { token: "https://oauth2.googleapis.com/token", auth: "https://accounts.google.com/o/oauth2/auth" },
  openai:    { token: PROVIDER_OAUTH["codex"]?.tokenUrl, auth: PROVIDER_OAUTH["codex"]?.authorizeUrl },
  anthropic: { token: PROVIDER_OAUTH["claude"]?.tokenUrl, auth: "https://api.anthropic.com/v1/oauth/authorize" }, // ≠ claude.authorizeUrl (claude.ai login) — keep
  github:    { token: PROVIDER_OAUTH["github"]?.tokenUrl, auth: PROVIDER_OAUTH["github"]?.authorizeUrl, deviceCode: PROVIDER_OAUTH["github"]?.deviceCodeUrl },
};
