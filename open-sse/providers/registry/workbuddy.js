const STATIC_VERIFIED_AT = "2026-09-11";
const CREDIT_SOURCE = "workbuddy-official-model-selector";

// WorkBuddy's coefficients are native credits, not USD/token prices. Keep them
// on model metadata so the USD cost engine never interprets xN as a currency.
const workbuddyModel = (id, name, metadata = {}) => ({
  id,
  name,
  displayName: name,
  upstreamModelId: id,
  catalogSource: "static",
  verifiedAt: STATIC_VERIFIED_AT,
  contextLength: 200000,
  maxOutputTokens: 64000,
  supportsVision: true,
  supportsReasoning: true,
  billingMode: "credits",
  ...metadata,
});

const creditModel = (id, name, creditMultiplier, metadata = {}) => workbuddyModel(id, name, {
  creditMultiplier,
  source: CREDIT_SOURCE,
  ...metadata,
});

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
        "hy4-preview / hy3 / deepseek-v4.1-flash currently run a free trial; other models draw from the account's credits.",
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
  // The live catalog is account-scoped, but unknown model ids should still be
  // routable when WorkBuddy adds a model before this static fallback is updated.
  passthroughModels: true,
  features: {
    usage: true,
    usageApikey: true,
  },
  serviceKinds: ["llm"],
  models: [
    workbuddyModel("hy4-preview", "Hy4 Preview (Free Trial)", { billingMode: "free_trial" }),
    workbuddyModel("hy3", "Hy3 (Free Trial)", { contextLength: 192000, billingMode: "free_trial" }),
    workbuddyModel("default-model", "Auto", { supportsReasoning: false, maxOutputTokens: 24000 }),
    workbuddyModel("fast-model", "Fast", { maxOutputTokens: 32000 }),
    workbuddyModel("balanced-model", "Balanced", { contextLength: 256000, maxOutputTokens: 32000 }),
    workbuddyModel("primary-model", "Primary", { contextLength: 272000, maxOutputTokens: 72000 }),
    workbuddyModel("deep-model", "Deep", { supportsReasoning: false, maxOutputTokens: 24000 }),
    workbuddyModel("gpt-5.6-sol", "GPT-5.6 Sol", { contextLength: 1000000, maxOutputTokens: 128000 }),
    workbuddyModel("gpt-5.6-terra", "GPT-5.6 Terra", { contextLength: 1000000, maxOutputTokens: 128000 }),
    workbuddyModel("gpt-5.6-luna", "GPT-5.6 Luna", { contextLength: 1000000, maxOutputTokens: 128000 }),
    workbuddyModel("gpt-5.5", "GPT-5.5", { contextLength: 1000000, maxOutputTokens: 128000 }),
    workbuddyModel("gpt-5.4", "GPT-5.4", { contextLength: 272000, maxOutputTokens: 72000 }),
    workbuddyModel("gpt-5.3-codex", "GPT-5.3 Codex", { contextLength: 272000, maxOutputTokens: 72000 }),
    workbuddyModel("gemini-3.5-flash", "Gemini 3.5 Flash", { contextLength: 1000000 }),
    workbuddyModel("glm-5.3", "GLM 5.3", { contextLength: 1000000, maxOutputTokens: 48000 }),
    workbuddyModel("glm-5.3-flash", "GLM 5.3 Flash", { contextLength: 200000 }),
    creditModel("glm-5.2", "GLM 5.2", 0.79, { contextLength: 1000000, maxOutputTokens: 48000 }),
    creditModel("glm-5.1", "GLM 5.1", 0.79, { contextLength: 1000000, maxOutputTokens: 48000 }),
    creditModel("glm-5v-turbo", "GLM 5v Turbo", 0.95, { contextLength: 200000, maxOutputTokens: 64000 }),
    creditModel("kimi-k3", "Kimi K3", 1.62, { contextLength: 1000000, maxOutputTokens: 32000 }),
    creditModel("kimi-k2.7-code", "Kimi K2.7 Code", 0.57, { contextLength: 1000000, maxOutputTokens: 64000 }),
    creditModel("kimi-k2.6", "Kimi K2.6", 0.52, { contextLength: 256000, maxOutputTokens: 32000 }),
    creditModel("minimax-m3", "MiniMax M3", 0.25, { contextLength: 512000, maxOutputTokens: 128000 }),
    workbuddyModel("minimax-m2.7", "MiniMax M2.7", { contextLength: 512000, maxOutputTokens: 128000 }),
    creditModel("deepseek-v4-flash", "DeepSeek V4 Flash", 0.06, { contextLength: 1000000, maxOutputTokens: 384000 }),
    creditModel("deepseek-v4-pro", "DeepSeek V4 Pro", 0.16, { contextLength: 1000000, maxOutputTokens: 384000 }),
    workbuddyModel("deepseek-v4.1-flash", "DeepSeek V4.1 Flash (Free Trial)", {
      contextLength: 1000000,
      maxOutputTokens: 384000,
      billingMode: "free_trial",
      isFree: true,
      source: "workbuddy-official-promo",
    }),
  ],
};
