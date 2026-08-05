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
  },
  transports: [
    { format: "openai", baseUrl: STEPFUN_ENDPOINTS.chat, auth: BEARER_AUTH },
    { format: "claude", baseUrl: STEPFUN_ENDPOINTS.messages, auth: BEARER_AUTH },
    { format: "openai-responses", baseUrl: STEPFUN_ENDPOINTS.responses, auth: BEARER_AUTH },
  ],
  models: STEPFUN_STATIC_MODEL_CATALOG,
  serviceKinds: ["llm", "image", "tts", "stt", "realtime"],
  ttsConfig: {
    baseUrl: STEPFUN_ENDPOINTS.speech,
    authType: "apikey",
    authHeader: "bearer",
    format: "stepfun",
    defaultModel: "step-tts-2",
  },
  sttConfig: {
    baseUrl: STEPFUN_ENDPOINTS.asr,
    authType: "apikey",
    authHeader: "bearer",
    format: "stepfun-asr-sse",
  },
  imageConfig: {
    baseUrl: STEPFUN_ENDPOINTS.images,
    editBaseUrl: STEPFUN_ENDPOINTS.imageEdits,
    defaultModel: "step-image-edit-2",
  },
  modelsFetcher: { url: STEPFUN_ENDPOINTS.models, type: "openai" },
};
