import {
  STEPFUN_API_MODES,
  STEPFUN_DEFAULT_API_MODE,
  STEPFUN_ENDPOINTS,
  STEPFUN_STATIC_MODEL_CATALOG,
} from "../stepfun.js";

const BEARER_AUTH = { combined: true, header: "Authorization", scheme: "bearer" };

export default {
  id: "stepfun",
  priority: 70,
  alias: "stepfun",
  display: {
    name: "StepFun (Token Plan)",
    icon: "bolt",
    color: "#2563EB",
    textIcon: "SF",
    website: "https://platform.stepfun.ai",
    notice: {
      apiKeyUrl: "https://platform.stepfun.ai/interface-key",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  apiModes: STEPFUN_API_MODES,
  defaultApiMode: STEPFUN_DEFAULT_API_MODE,
  thinkingConfig: {
    options: ["auto", "none", "low", "medium", "high"],
    defaultMode: "auto",
  },
  transport: {
    baseUrl: STEPFUN_ENDPOINTS.chat,
    validateUrl: STEPFUN_ENDPOINTS.models,
    thinkingFormat: "step",
    auth: BEARER_AUTH,
    // Prepaid account snapshot (works for token-plan keys too).
    usage: {
      url: "https://api.stepfun.ai/v1/accounts",
    },
  },
  transports: [
    { format: "openai", baseUrl: STEPFUN_ENDPOINTS.chat, auth: BEARER_AUTH },
    { format: "claude", baseUrl: STEPFUN_ENDPOINTS.messages, auth: BEARER_AUTH },
    { format: "openai-responses", baseUrl: STEPFUN_ENDPOINTS.responses, auth: BEARER_AUTH },
  ],
  models: STEPFUN_STATIC_MODEL_CATALOG,
  modelsFetcher: { url: STEPFUN_ENDPOINTS.models, type: "openai" },
  features: {
    usage: true,
    usageApikey: true,
  },
};
