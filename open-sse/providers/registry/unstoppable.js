// Unstoppable Code (Canopy Cloud) — Anthropic Messages LLM proxy.
//
// Reverse-engineered from the Unstoppable Code desktop app (app.asar, v1.5.0).
// The app proxies Claude Code through a cloud LLM gateway:
//   https://app.unstoppable.ai/api/v1/llm-proxy/anthropic        (Anthropic Messages)
//   https://app.unstoppable.ai/api/v1/llm-proxy/openai/responses (OpenAI Responses)
// The app maps a harness to a base URL — `claude` → .../llm-proxy/anthropic (then the
// SDK appends /v1/messages), `codex` → .../llm-proxy/openai/responses (Codex appends
// /v1/responses). The Anthropic surface accepts EVERY catalog model, not just the
// anthropic/* ones: POSTing {model:"openai/gpt-5.6-luna"} returns a normal Anthropic
// SSE stream (verified live, HTTP 200), so one transport covers the whole catalog.
//
// Auth is a single Bearer token (the "cskToken") that IS the account's API key,
// acquired either by pasting an API key or via the desktop OAuth flow:
//   GET  /desktop-auth           (PKCE S256, params: state/code_challenge/
//                                 redirect_uri/client_name/client_device_id/
//                                 client_version/client_hostname)
//   POST /api/v1/desktop-app/desktop-auth/token
//                                 (JSON, camelCase body: grantType/code/codeVerifier/
//                                  redirectUri/clientName/clientDeviceId/clientVersion/
//                                  clientHostname/correlationId)
// The token response is camelCase and carries the credential in `token` (not oauth2's
// `access_token`) plus `account`/`capabilities`/`organizations`/`userApiKey`.
//
// QUIRKS THAT MATTER:
//   1. stream:true is MANDATORY — a non-stream request is rejected with
//      {"error":"LLM proxy requests must set stream: true."} → forceStream.
//   2. The proxy routes on `gatewayId` (`<family>/<model>`), not the bare model id.
//      Catalog ids are the short form, so each entry carries upstreamModelId.
//   3. Catalog is fetched at runtime from
//      GET /api/v1/desktop-app/ai-gateway/models?catalogVersion=5
//      ({version, models:[{id, gatewayId, label, family, contextWindow, ...}]}).
//      The list below is a snapshot of that catalog (25 models); access per model
//      still depends on the plan, and the gateway is the final authority.

export default {
  id: "unstoppable",
  priority: 60,
  alias: "udc",
  uiAlias: "udc",
  display: {
    name: "Unstoppable Code",
    icon: "rocket_launch",
    color: "#5B21B6",
    textIcon: "UD",
    website: "https://code.unstoppabledomains.com",
    notice: {
      signupUrl: "https://app.unstoppable.ai",
    },
  },
  category: "oauth",
  // The desktop app itself offers BOTH entry paths for the same cskToken:
  // OAuth login and a "paste API key" settings field (settingsValidateCanopyCloudApiKey).
  // Declaring both lets a Pro user skip the OAuth dance entirely if they already
  // have an API key, while the login button still runs the PKCE flow.
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://app.unstoppable.ai/api/v1/llm-proxy/anthropic/v1/messages",
    format: "claude",
    urlSuffix: "?beta=true",
    // The proxy rejects non-streaming requests outright, so coerce the flag on.
    forceStream: true,
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14",
      "User-Agent": "claude-cli/2.1.92 (external, sdk-cli)",
      "X-Stainless-Helper-Method": "stream",
      "X-Stainless-Retry-Count": "0",
      "X-Stainless-Runtime": "node",
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": "0.80.0",
    },
    auth: {
      // The cskToken is a single Bearer credential whether it came from a pasted
      // API key or the OAuth access token — combined descriptor, not split.
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
    // The cloud LLM proxy sits behind the same 15s+ queue as other aggregators;
    // a Pro plan can take a while to emit the first byte on cold models.
    timeoutMs: 120 * 1000,
    usage: {
      url: "https://app.unstoppable.ai/api/v1/ai-credits/balance",
      subscriptionUrl: "https://app.unstoppable.ai/api/v1/ai-credits/subscription",
    },
  },
  // Snapshot of GET /api/v1/desktop-app/ai-gateway/models?catalogVersion=5.
  // `id` is the short catalog id (what users type after `udc/`); upstreamModelId is
  // the gatewayId the proxy actually routes on.
  models: [
    // Anthropic family
    { id: "claude-opus-5", name: "Opus 5", upstreamModelId: "anthropic/claude-opus-5", contextWindow: 1000000 },
    { id: "claude-sonnet-5", name: "Sonnet 5", upstreamModelId: "anthropic/claude-sonnet-5", contextWindow: 1000000 },
    { id: "claude-fable-5.1", name: "Fable 5.1", upstreamModelId: "anthropic/claude-fable-5.1", contextWindow: 1000000 },
    { id: "claude-fable-5", name: "Fable 5", upstreamModelId: "anthropic/claude-fable-5", contextWindow: 1000000 },
    { id: "claude-opus-4.8", name: "Opus 4.8", upstreamModelId: "anthropic/claude-opus-4.8", contextWindow: 1000000 },
    { id: "claude-opus-4.7", name: "Opus 4.7", upstreamModelId: "anthropic/claude-opus-4.7", contextWindow: 1000000 },
    { id: "claude-opus-4.6", name: "Opus 4.6", upstreamModelId: "anthropic/claude-opus-4.6", contextWindow: 1000000 },
    { id: "claude-haiku-4.5", name: "Haiku 4.5", upstreamModelId: "anthropic/claude-haiku-4.5", contextWindow: 200000 },
    // OpenAI family
    { id: "gpt-5.6-sol", name: "GPT 5.6 Sol", upstreamModelId: "openai/gpt-5.6-sol", contextWindow: 1050000 },
    { id: "gpt-5.6-terra", name: "GPT 5.6 Terra", upstreamModelId: "openai/gpt-5.6-terra", contextWindow: 1050000 },
    { id: "gpt-5.6-luna", name: "GPT 5.6 Luna", upstreamModelId: "openai/gpt-5.6-luna", contextWindow: 1050000 },
    { id: "gpt-5.5", name: "GPT 5.5", upstreamModelId: "openai/gpt-5.5", contextWindow: 1050000 },
    { id: "gpt-5.4", name: "GPT 5.4", upstreamModelId: "openai/gpt-5.4", contextWindow: 1050000 },
    { id: "gpt-5.4-mini", name: "GPT 5.4 Mini", upstreamModelId: "openai/gpt-5.4-mini", contextWindow: 400000 },
    // DeepSeek family
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", upstreamModelId: "deepseek/deepseek-v4-pro", contextWindow: 1000000 },
    { id: "deepseek-v4-pro-0813", name: "DeepSeek V4 Pro (0813)", upstreamModelId: "deepseek/deepseek-v4-pro-0813", contextWindow: 1000000 },
    { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", upstreamModelId: "deepseek/deepseek-v4.1-flash", contextWindow: 1048576 },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", upstreamModelId: "deepseek/deepseek-v4-flash", contextWindow: 1000000 },
    { id: "deepseek-v4-flash-0731", name: "DeepSeek V4 Flash (0731)", upstreamModelId: "deepseek/deepseek-v4-flash-0731", contextWindow: 1000000 },
    // Moonshot family
    { id: "kimi-k3", name: "Kimi K3", upstreamModelId: "moonshotai/kimi-k3", contextWindow: 1000000 },
    { id: "kimi-k2-thinking", name: "Kimi K2 Thinking", upstreamModelId: "moonshotai/kimi-k2-thinking", contextWindow: 216144 },
    // MiniMax family
    { id: "minimax-m3", name: "MiniMax M3", upstreamModelId: "minimax/minimax-m3", contextWindow: 512000 },
    // Zai family
    { id: "glm-5.3", name: "GLM 5.3", upstreamModelId: "zai/glm-5.3", contextWindow: 1000000 },
    { id: "glm-5.3-flash", name: "GLM 5.3 Flash", upstreamModelId: "zai/glm-5.3-flash", contextWindow: 1000000 },
    { id: "glm-5.2", name: "GLM-5.2", upstreamModelId: "zai/glm-5.2", contextWindow: 1000000 },
  ],
  // Escape hatch: the gateway accepts any `family/model` gatewayId, so a model that
  // appears in the catalog after this snapshot still works when called with its
  // full gatewayId (e.g. `udc/anthropic/claude-opus-5`).
  passthroughModels: true,
  oauth: {
    authorizeUrl: "https://app.unstoppable.ai/desktop-auth",
    tokenUrl: "https://app.unstoppable.ai/api/v1/desktop-app/desktop-auth/token",
    codeChallengeMethod: "S256",
    callbackPath: "/canopy-cloud/oauth/callback",
    clientName: "Unstoppable Code Desktop",
    // No refresh flow: the credential is a long-lived account API key (cskToken)
    // and the token response carries no expiry, so no refreshLeadMs is declared.
  },
  features: {
    usage: true,
    // The AI Credits endpoints accept the same cskToken as the LLM proxy, so a
    // pasted-API-key connection exposes quota too, not just an OAuth one.
    usageApikey: true,
  },
};
