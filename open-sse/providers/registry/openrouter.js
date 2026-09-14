export default {
  id: "openrouter",
  priority: 10,
  hasFree: true,
  alias: "openrouter",
  display: {
    name: "OpenRouter",
    icon: "router",
    color: "#F97316",
    textIcon: "OR",
    website: "https://openrouter.ai",
    notice: {
      text: "Free tier: 27+ free models, no credit card needed, 200 req/day. After  0 credit: 1,000 req/day.",
      apiKeyUrl: "https://openrouter.ai/settings/keys",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    thinkingFormat: "openai",
    headers: {
      "HTTP-Referer": "https://endpoint-proxy.local",
      "X-Title": "Endpoint Proxy",
    },
    // OpenRouter is an aggregator, and its free-tier models can sit in an
    // upstream queue for a very long time before the first byte. Measured on
    // nex-agi/nex-n2.5-pro:free (6 consecutive calls, all HTTP 200):
    // 9s, 15s, 29s, 49s, 100s, 115s — a long tail that the default 15s
    // FETCH_CONNECT_TIMEOUT_MS aborts every attempt as a "fetch connect timeout"
    // 502, burning all 4 accounts and tripping the 45s routing deadline, so the
    // model appears permanently dead even though every call eventually succeeds.
    // 180s covers the observed tail with headroom while still capping a genuinely
    // dead upstream, instead of a global env bump that would cost every other
    // provider the same wait. ROUTING_DEADLINE_MS (45s) only gates STARTING a new
    // attempt, so the first attempt still needs the full window to answer.
    timeoutMs: 180 * 1000,
  },
  modelsFetcher: { url: "https://openrouter.ai/api/v1/models", type: "openrouter-free" },
  passthroughModels: true,
};
