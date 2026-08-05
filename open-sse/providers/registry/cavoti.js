import {
  CAVOTI_ENDPOINT_PROFILES,
  CAVOTI_CHAT_PATH,
  CAVOTI_DEFAULT_MODEL_PATH,
  CAVOTI_MODEL_CATALOG,
  CAVOTI_MODEL_PRICING_URL,
  CAVOTI_USAGE_PATH,
  CAVOTI_VIDEO_PATH,
  resolveCavotiEndpoint,
} from "../cavoti.js";

export default {
  id: "cavoti",
  priority: 118,
  alias: "cavoti",
  display: {
    name: "Cavoti",
    icon: "hub",
    color: "#0F766E",
    textIcon: "CA",
    website: "https://cavoti.com",
    notice: {
      apiKeyUrl: "https://cavoti.com/register?aff=4W6J89CPVV7G",
      text: "OpenAI-compatible LLM, image, and video endpoints. Image generation always uses the dedicated image endpoint.",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: resolveCavotiEndpoint({ path: CAVOTI_CHAT_PATH }),
    validateUrl: resolveCavotiEndpoint({ path: CAVOTI_DEFAULT_MODEL_PATH }),
    usage: { url: resolveCavotiEndpoint({ path: CAVOTI_USAGE_PATH }) },
  },
  endpointProfiles: CAVOTI_ENDPOINT_PROFILES,
  models: CAVOTI_MODEL_CATALOG,
  serviceKinds: ["llm", "image", "video"],
  imageConfig: {
    baseUrl: CAVOTI_ENDPOINT_PROFILES.images.baseUrl,
    defaultModel: "gpt-image-2",
    bodyFields: ["model", "prompt", "n", "size", "quality", "response_format"],
  },
  videoConfig: {
    baseUrl: resolveCavotiEndpoint({ path: CAVOTI_VIDEO_PATH }),
    endpointProfiles: CAVOTI_ENDPOINT_PROFILES,
  },
  modelsFetcher: {
    url: resolveCavotiEndpoint({ path: CAVOTI_DEFAULT_MODEL_PATH }),
    type: "openai",
  },
  catalogConfig: {
    pricingUrl: CAVOTI_MODEL_PRICING_URL,
    staticFallback: true,
  },
  features: {
    usage: true,
    usageApikey: true,
  },
};
