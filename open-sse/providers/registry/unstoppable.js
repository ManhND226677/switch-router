// Unstoppable Code (Canopy Cloud) — Anthropic Messages LLM proxy.
//
// Reverse-engineered from the Unstoppable Code desktop app v1.5.0 (app.asar).
// The app proxies Claude Code through a cloud LLM gateway:
//   https://app.unstoppable.ai/api/v1/llm-proxy/anthropic  (Anthropic Messages)
//   https://app.unstoppable.ai/api/v1/llm-proxy/openai/responses (OpenAI Responses)
// Auth is a single Bearer token (the "cskToken") that is literally the account's
// API key, acquired either by pasting an API key or via the desktop OAuth flow:
//   GET  /desktop-auth           (PKCE S256, params: state/code_challenge/
//                                 redirect_uri/client_name/client_device_id/
//                                 client_version/client_hostname)
//   POST /api/v1/desktop-app/desktop-auth/token
//                                 (JSON, camelCase body: grantType/code/codeVerifier/
//                                  redirectUri/clientName/clientDeviceId/clientVersion/
//                                  clientHostname/correlationId)
// The proxy only accepts /v1/messages and /v1/messages/count_tokens with
// ?beta=true, and forwards anthropic-beta/anthropic-version/user-agent/
// x-stainless-* headers. Models are served dynamically per plan (the app fetches
// a catalog at runtime), so we passthrough the client's model id and only ship a
// small fallback list.

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
    },
  },
  models: [
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4-5-20251001", name: "Claude 4.5 Haiku" },
    { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
    { id: "claude-opus-4-7", name: "Claude Opus 4.7" },
  ],
  passthroughModels: true,
  oauth: {
    authorizeUrl: "https://app.unstoppable.ai/desktop-auth",
    tokenUrl: "https://app.unstoppable.ai/api/v1/desktop-app/desktop-auth/token",
    codeChallengeMethod: "S256",
    callbackPath: "/canopy-cloud/oauth/callback",
    clientName: "Unstoppable Code Desktop",
    refreshLeadMs: 14400000,
  },
  features: {
    usage: true,
  },
};
