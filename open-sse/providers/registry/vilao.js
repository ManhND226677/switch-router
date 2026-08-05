export default {
  id: "vilao",
  priority: 162,
  alias: "vilao",
  aliases: [
    "vilao-ai",
  ],
  uiAlias: "vilao",
  display: {
    name: "ViLao AI",
    icon: "hub",
    color: "#0EA5E9",
    textIcon: "VL",
    // Referral link — the dashboard's "Get API Key" button and every provider
    // link point here so sign-ups are attributed. After signing up, the key
    // itself lives at Console → LLM → My API Keys (spelled out in the notice).
    website: "https://vilao.ai/r/REF2fXFGBsf",
    notice: {
      text: "P2P marketplace behind one OpenAI-compatible endpoint. Sign up via the link, then create a key at Console → LLM → My API Keys and subscribe models to it. Model ids are the marketplace ids/aliases on that key (e.g. moonshotai/kimi-k3-free), and any id is accepted. Unsubscribed models return 403; an empty wallet returns 402. Routing (round-robin / fallback / cheapest) is handled upstream by ViLao.",
      apiKeyUrl: "https://vilao.ai/r/REF2fXFGBsf",
      signupUrl: "https://vilao.ai/r/REF2fXFGBsf",
    },
  },
  category: "apikey",
  // No thinkingConfig on purpose: ViLao forwards `reasoning_effort` to whichever
  // upstream model the key is subscribed to, and the MODEL decides. Measured
  // 2026-08-04 on moonshotai/kimi-k3-free: "high"/"medium" → 200, but "none" and
  // "minimal" → 400 BAD_REQUEST "This model does not accept the requested
  // reasoning effort". Since the model set is user-defined per key, no fixed
  // option list is safe — leave the client's value untouched.
  transport: {
    baseUrl: "https://api.vilao.ai/v1/chat/completions",
    validateUrl: "https://api.vilao.ai/v1/models",
    thinkingFormat: "openai",
    // Measured 2026-08-04 against api.vilao.ai: streaming succeeded 10/10 while
    // non-streaming hung past 45s on 5 of 9 attempts. Always request SSE
    // upstream; chatCore converts it back to JSON when the client wants JSON
    // (handleForcedSSEToJson), so non-streaming clients still work reliably.
    forceStream: true,
    retry: {
      "429": 2,
    },
  },
  serviceKinds: ["llm","embedding"],
  embeddingConfig: {
    // Verified reachable; requires an embedding model subscribed to the key
    // (an unsubscribed model answers 403 FORBIDDEN "Please subscribe to model").
    baseUrl: "https://api.vilao.ai/v1/embeddings",
    authType: "apikey",
    authHeader: "bearer",
  },
  modelsFetcher: { url: "https://api.vilao.ai/v1/models", type: "openai" },
  passthroughModels: true,
};
