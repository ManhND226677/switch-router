export default {
  id: "workbuddy",
  priority: 155,
  alias: "workbuddy",
  aliases: [
    "wb",
    "workbuddy-ai",
  ],
  uiAlias: "wb",
  display: {
    name: "WorkBuddy AI",
    icon: "smart_toy",
    color: "#2F7DF6",
    textIcon: "WB",
    website: "https://www.workbuddy.ai",
    notice: {
      text: "Tencent CodeBuddy desktop-app account, exposed as an OpenAI-compatible endpoint. " +
        "The OAuth button instantly imports the account already logged into the WorkBuddy AI desktop app on this machine; " +
        "the OAuth (Web Login) button always opens the real WorkBuddy web login so additional accounts get their own connections. " +
        "API key \"auto\" also tracks the desktop app session, or paste an accessToken JWT. " +
        "hy4-preview / hy3 currently run a free trial; other models draw from the account's credits.",
    },
  },
  category: "oauth",
  // Grouped with OAuth providers (the credential is a Keycloak session token),
  // but the gateway cannot run the login flow itself — connections are added
  // via the apikey mode: "auto" reads the desktop app's session file.
  authModes: [
    "oauth",
    "apikey",
  ],
  authType: "apikey",
  authHint: "\"auto\" = reuse the WorkBuddy AI desktop app session; or paste an accessToken JWT; or use the OAuth button for browser login",
  transport: {
    baseUrl: "https://www.workbuddy.ai/v2/chat/completions",
    // Measured 2026-08-28: upstream rejects non-stream requests with
    // code 11101 "Non-stream chat request is currently not supported".
    forceStream: true,
  },
  serviceKinds: ["llm"],
  models: [
    { id: "hy4-preview", name: "Hy4 Preview (Free Trial)" },
    { id: "hy3", name: "Hy3 (Free Trial)" },
    { id: "default-model", name: "Auto" },
    { id: "fast-model", name: "Fast" },
    { id: "balanced-model", name: "Balanced" },
    { id: "primary-model", name: "Primary" },
    { id: "deep-model", name: "Deep" },
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
    { id: "gpt-5.6-terra", name: "GPT-5.6 Terra" },
    { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
    { id: "gpt-5.5", name: "GPT-5.5" },
    { id: "gpt-5.4", name: "GPT-5.4" },
    { id: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
    { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" },
    { id: "glm-5.3", name: "GLM 5.3" },
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "kimi-k3", name: "Kimi K3" },
    { id: "kimi-k2.6", name: "Kimi K2.6" },
    { id: "minimax-m3", name: "MiniMax M3" },
  ],
};
