import {
  ANTIGRAVITY_IDE_BASE_URL,
  ANTIGRAVITY_IDE_PROD_BASE_URL,
  ANTIGRAVITY_IDE_USER_AGENT,
  ANTIGRAVITY_OAUTH_CLIENT,
} from "../shared.js";

export default {
  id: "antigravity",
  priority: 20,
  alias: "ag",
  uiAlias: "ag",
  display: {
    name: "Antigravity",
    icon: "rocket_launch",
    color: "#F59E0B",
    website: "https://antigravity.google",
    notice: {
      signupUrl: "https://antigravity.google",
    },
    deprecated: true,
    deprecationNotice: "RISK_NOTICE",
  },
  category: "oauth",
  transport: {
    // Prefer daily host (IDE chat path). Fall back to prod if daily is down.
    baseUrls: [ANTIGRAVITY_IDE_BASE_URL, ANTIGRAVITY_IDE_PROD_BASE_URL],
    format: "antigravity",
    headers: {
      "User-Agent": ANTIGRAVITY_IDE_USER_AGENT,
    },
    retry: {
      "429": {
        attempts: 3,
      },
      "500": {
        attempts: 3,
      },
      "503": {
        attempts: 3,
      },
    },
    usage: {
      // Catalog/quota/project discovery stay on prod (stable + already working).
      quotaApiUrl: `${ANTIGRAVITY_IDE_PROD_BASE_URL}/v1internal:fetchAvailableModels`,
      loadProjectApiUrl: `${ANTIGRAVITY_IDE_PROD_BASE_URL}/v1internal:loadCodeAssist`,
      tokenUrl: "https://oauth2.googleapis.com/token",
    },
    clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
    clientSecret: "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",
  },
  // Gemini: only newest Flash (3.7) + newest Pro (3.1). No older flash/pro/image.
  // Claude / GPT-OSS still exposed via Antigravity.
  models: [
    { id: "gemini-3.7-flash-high", name: "Gemini 3.7 Flash (High)" },
    { id: "gemini-3.7-flash-medium", name: "Gemini 3.7 Flash (Medium)" },
    { id: "gemini-3.7-flash-low", name: "Gemini 3.7 Flash (Low)" },
    { id: "gemini-pro-agent", name: "Gemini 3.1 Pro (High)" },
    { id: "gemini-3.1-pro-high", name: "Gemini 3.1 Pro (High · explicit)" },
    { id: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)" },
    { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)" },
    { id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
  ],
  oauth: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://www.googleapis.com/oauth2/v1/userinfo",
    scopes: [
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/cclog",
      "https://www.googleapis.com/auth/experimentsandconfigs",
    ],
    // OAuth discovery stays on prod; chat generate uses transport.baseUrls (daily first).
    apiEndpoint: ANTIGRAVITY_IDE_PROD_BASE_URL,
    apiVersion: "v1internal",
    loadCodeAssistEndpoint: `${ANTIGRAVITY_IDE_PROD_BASE_URL}/v1internal:loadCodeAssist`,
    onboardUserEndpoint: `${ANTIGRAVITY_IDE_PROD_BASE_URL}/v1internal:onboardUser`,
    loadCodeAssistUserAgent: "google-api-nodejs-client/9.15.1",
    loadCodeAssistApiClient: "google-cloud-sdk vscode_cloudshelleditor/0.1",
    refreshLeadMs: 300000,
  },
  features: {
    usage: true,
  },
};
