import {
  NOVITA_BASE_URL,
  NOVITA_CHAT_COMPLETIONS_URL,
  NOVITA_MODELS_URL,
  NOVITA_STATIC_MODEL_CATALOG,
} from "../novita.js";

const BEARER_AUTH = { combined: true, header: "Authorization", scheme: "bearer" };

export default {
  id: "novita",
  priority: 88,
  alias: "novita",
  aliases: ["novita-ai"],
  uiAlias: "novita",
  display: {
    name: "Novita AI",
    icon: "cloud",
    color: "#6D5DFB",
    textIcon: "NV",
    website: "https://novita.ai",
    notice: {
      text: "OpenAI-compatible Novita AI LLM API. Add a Novita API key to load the account's live model catalog, balance and RPM/TPM limits.",
      signupUrl: "https://novita.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  authHint: "Paste a Novita API key. It is sent as a Bearer token to api.novita.ai.",
  passthroughModels: true,
  serviceKinds: ["llm"],
  transport: {
    baseUrl: NOVITA_CHAT_COMPLETIONS_URL,
    format: "openai",
    auth: BEARER_AUTH,
    validateUrl: NOVITA_MODELS_URL,
    forceStream: false,
  },
  models: NOVITA_STATIC_MODEL_CATALOG,
  features: {
    usage: true,
    usageApikey: true,
  },
};

