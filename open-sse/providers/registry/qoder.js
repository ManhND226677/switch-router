export default {
  id: "qoder",
  priority: 30,
  alias: "qd",
  uiAlias: "qd",
  display: {
    name: "Qoder",
    icon: "water_drop",
    color: "#EC4899",
    website: "https://qoder.com",
    notice: {
      signupUrl: "https://qoder.com",
    },
    deprecated: true,
    deprecationNotice: "RISK_NOTICE",
  },
  category: "free",
  transport: {
    baseUrl: "https://api3.qoder.sh/algo/api/v2/service/pro/sse/agent_chat_generation",
    headers: {},
    timeoutMs: 120000,
    stallTimeoutMs: 120000,
    usage: {
      url: "https://openapi.qoder.sh/api/v2/quota/usage",
    },
  },
  models: [
    // Active/recommended model — matches the account's live catalog
    // (2026-08-09: is_default=true, is_free=true). Only free Qoder model.
    { id: "qmodel_38max", name: "Qoder Qwen 3.8 Max", free: true }, // FREE (is_free=true)
    // Reference only — disabled in the account's live catalog; upstream may
    // still accept chat for these keys (model_config is fetched live).
    // { id: "auto", name: "Qoder Auto" },
    // { id: "ultimate", name: "Qoder Ultimate" },
    // { id: "performance", name: "Qoder Performance" },
    // { id: "efficient", name: "Qoder Efficient" },
    // { id: "qmodel_latest", name: "Qoder Qwen 3.7 Max" },
    // { id: "qmodel", name: "Qoder Qwen 3.7 Plus" },
    // { id: "kmodel_latest", name: "Qoder Kimi-K3" },
    // { id: "kmodel", name: "Qoder Kimi-K2.7-Code" },
    // { id: "gm51model", name: "Qoder GLM-5.2" },
    // { id: "dmodel", name: "Qoder DeepSeek-V4-Pro" },
    // { id: "dfmodel", name: "Qoder DeepSeek-V4-Flash" },
    // { id: "mmodel", name: "Qoder MiniMax-M3" },
  ],
  oauth: {
    openApiBaseUrl: "https://openapi.qoder.sh",
    centerBaseUrl: "https://center.qoder.sh",
    chatBaseUrl: "https://api3.qoder.sh",
    deviceTokenUrl: "https://openapi.qoder.sh/api/v1/deviceToken/poll",
    refreshUrl: "https://center.qoder.sh/algo/api/v3/user/refresh_token",
    userInfoUrl: "https://openapi.qoder.sh/api/v1/userinfo",
    quotaUsageUrl: "https://openapi.qoder.sh/api/v2/quota/usage",
    loginUrl: "https://qoder.com/device/selectAccounts",
  },
  features: {
    usage: true,
  },
};
