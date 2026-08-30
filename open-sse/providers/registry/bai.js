export default {
  id: "bai",
  priority: 50,
  hasFree: true,
  alias: "bai",
  uiAlias: "bai",
  display: {
    name: "B.AI",
    icon: "auto_awesome",
    color: "#7C5CFF",
    textIcon: "BAI",
    website: "https://b.ai",
    notice: {
      text: "OpenAI-compatible aggregator. A rotating free subset runs on a 0-balance key — " +
        "measured 2026-08-30: hy3, glm-5.3-flash, deepseek-v4-flash, qwen3.8-flash, mimo-v2.5, " +
        "deepseek-v4-flash-vision-exp. Everything else answers 403 \"Deposit required\" or a " +
        "credit-insufficient error; the free quota is small and resets — premium models are " +
        "deliberately not listed, add them as custom models on the connection if you deposit.",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.b.ai/v1/chat/completions",
    validateUrl: "https://api.b.ai/v1/models",
  },
  models: [
    { id: "hy3", name: "Hy3 (Free)" },
    { id: "glm-5.3-flash", name: "GLM 5.3 Flash" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek-v4-flash-vision-exp", name: "DeepSeek V4 Flash Vision (Exp)" },
    { id: "qwen3.8-flash", name: "Qwen 3.8 Flash" },
    { id: "mimo-v2.5", name: "MiMo V2.5" },
  ],
};
