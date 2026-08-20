import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { testProxyUrl } from "@/lib/network/proxyTest";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { getDefaultModel } from "open-sse/config/providerModels.js";
import { resolveOllamaLocalHost, PROVIDERS } from "open-sse/config/providers.js";
import { resolveVilaoConnectionEndpoint, VILAO_MODELS_PATH } from "open-sse/providers/vilao.js";
import { resolveStepFunEndpoints } from "open-sse/providers/stepfun.js";
import {
  refreshProviderCredentials,
  shouldRefreshCredentials,
} from "open-sse/services/oauthCredentialManager.js";
import {
  GEMINI_CONFIG,
  ANTIGRAVITY_CONFIG,
  QWEN_CONFIG,
  CLAUDE_CONFIG,
  KILOCODE_CONFIG,
} from "@/lib/oauth/constants/oauth";


// OAuth provider test endpoints
const OAUTH_TEST_CONFIG = {
  claude: { checkExpiry: true, refreshable: true },
  codex: {
    url: "https://chatgpt.com/backend-api/codex/responses",
    method: "POST",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    extraHeaders: { "Content-Type": "application/json", "originator": "codex_cli_rs", "User-Agent": "codex_cli_rs/0.136.0" },
    // Minimal invalid body — triggers fast 400 without consuming quota
    body: JSON.stringify({ model: "gpt-5.3-codex", input: [], stream: false, store: false }),
    // 400 (bad request) means auth succeeded; only 401/403 means token is bad
    acceptStatuses: [400],
    refreshable: true,
  },
  "gemini-cli": {
    url: "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    refreshable: true,
  },
  antigravity: {
    url: "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    refreshable: true,
  },
  github: {
    url: "https://api.github.com/user",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    extraHeaders: { "User-Agent": "Switch-Router", "Accept": "application/vnd.github+json" },
  },
  qwen: { checkExpiry: true, refreshable: true },

  qoder: {
    // Test by hitting Qoder's userinfo endpoint with the device token.
    // refreshable: false because the device-flow refresh endpoint returns
    // 403 for our flow (users re-login when expired). No checkExpiry —
    // we want the actual URL probe to run so revoked tokens surface.
    url: "https://openapi.qoder.sh/api/v1/userinfo",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    refreshable: false,
  },
  "kimi-coding": { checkExpiry: true, refreshable: false },
  cursor: { tokenExists: true },
  kilocode: {
    url: `${KILOCODE_CONFIG.apiBaseUrl}/api/profile`,
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
  },
  // Grok CLI / Grok Build — probe /v1/user (no inference quota). Headers mirror official CLI.
  "grok-cli": {
    url: PROVIDERS["grok-cli"]?.userUrl || "https://cli-chat-proxy.grok.com/v1/user",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    extraHeaders: {
      Accept: "application/json",
      ...(PROVIDERS["grok-cli"]?.headers || {
        "User-Agent": "grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)",
        "x-xai-token-auth": "xai-grok-cli",
        "x-grok-client-identifier": "grok-pager",
        "x-grok-client-version": "0.2.93",
      }),
    },
    refreshable: true,
    // Subscription spending-limit is not an auth failure — token is fine, credits aren't.
    // Accept 402 so the connection stays "active" with a warning (same idea as Codex 400).
    acceptStatuses: [402],
    softFailMessage: {
      402: "Connected, but Grok Build credits are exhausted (spending limit). Add credits or upgrade SuperGrok.",
    },
  },
};

/**
 * Classify an OAuth probe response as success / soft-success / hard-fail.
 * Soft success (e.g. 402 spending-limit on Grok CLI) means auth works but the
 * account cannot spend — keep connection active and surface a warning.
 * Exported for unit tests.
 */
export function classifyOAuthProbeResult(res, config, bodyText = "") {
  if (!res) return { valid: false, error: "No response", soft: false };
  const status = res.status;
  const accepted = res.ok || (config?.acceptStatuses && config.acceptStatuses.includes(status));
  if (!accepted) {
    if (status === 401) return { valid: false, error: "Token invalid or revoked", soft: false };
    if (status === 403) return { valid: false, error: "Access denied", soft: false };
    return { valid: false, error: `API returned ${status}`, soft: false };
  }

  // Soft success only when the provider configured an explicit message for this
  // status (e.g. Grok CLI 402 spending-limit). Codex-style acceptStatuses:[400]
  // stays silent success — 400 there only proves auth, not a user-facing warning.
  if (!res.ok && config?.acceptStatuses?.includes(status)) {
    const softMap = config.softFailMessage || {};
    if (softMap[status]) {
      return { valid: true, error: softMap[status], soft: true };
    }
    return { valid: true, error: null, soft: false };
  }

  return { valid: true, error: null, soft: false };
}

const CLOUD_CODE_ASSIST_TEST_URL = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
const CLOUD_CODE_ASSIST_TEST_BODY = JSON.stringify({
  metadata: {
    ideType: "IDE_UNSPECIFIED",
    platform: "PLATFORM_UNSPECIFIED",
    pluginType: "GEMINI",
  },
});

function parseProviderErrorMessage(bodyText, fallback) {
  if (!bodyText) return fallback;
  try {
    const parsed = JSON.parse(bodyText);
    const message = parsed?.error?.message || parsed?.message || parsed?.error;
    if (typeof message === "string" && message.trim()) return message.trim();
    if (message) return JSON.stringify(message);
  } catch {
    // fall through
  }
  return bodyText.trim() || fallback;
}

async function probeCloudCodeAssistAccess(connection, accessToken, effectiveProxy = null) {
  const userAgent = connection.provider === "antigravity"
    ? "google-api-nodejs-client/9.15.1 vscode-antigravity/1.107.0"
    : "google-api-nodejs-client/9.15.1 gemini-cli/0.34.0";

  const res = await fetchWithConnectionProxy(CLOUD_CODE_ASSIST_TEST_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": userAgent,
    },
    body: CLOUD_CODE_ASSIST_TEST_BODY,
  }, effectiveProxy);

  if (res.ok) return { valid: true, error: null };

  const bodyText = await res.text().catch(() => "");
  return {
    valid: false,
    error: parseProviderErrorMessage(bodyText, `API returned ${res.status}`),
    status: res.status,
  };
}

async function refreshOAuthToken(connection) {
  const provider = connection.provider;
  const refreshToken = connection.refreshToken;
  if (!refreshToken) return null;

  try {
    if (provider === "gemini-cli" || provider === "antigravity") {
      const config = provider === "gemini-cli" ? GEMINI_CONFIG : ANTIGRAVITY_CONFIG;
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return { accessToken: data.access_token, expiresIn: data.expires_in, refreshToken: data.refresh_token || refreshToken };
    }

    if (provider === "codex" || provider === "grok-cli" || provider === "xai") {
      return await refreshProviderCredentials(provider, connection, console);
    }

    if (provider === "claude") {
      const response = await fetch(CLAUDE_CONFIG.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: CLAUDE_CONFIG.clientId,
        }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return { accessToken: data.access_token, expiresIn: data.expires_in, refreshToken: data.refresh_token || refreshToken };
    }

    if (provider === "qwen") {
      const response = await fetch(QWEN_CONFIG.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: QWEN_CONFIG.clientId,
        }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return { accessToken: data.access_token, expiresIn: data.expires_in, refreshToken: data.refresh_token || refreshToken };
    }

    if (provider === "kimi-coding") {
      const kimiHeaders = buildKimiHeaders();
      const response = await fetch(KIMI_CODING_CONFIG.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
          ...kimiHeaders,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: KIMI_CODING_CONFIG.clientId,
        }),
      });
      if (!response.ok) return null;
      const tokens = await response.json();
      return {
        accessToken: tokens.access_token,
        expiresIn: tokens.expires_in,
        refreshToken: tokens.refresh_token || refreshToken,
      };
    }

    return null;
  } catch (err) {
    console.log(`Error refreshing ${provider} token:`, err.message);
    return null;
  }
}

function isTokenExpired(connection) {
  return shouldRefreshCredentials(connection.provider, connection);
}

async function testOAuthConnection(connection, effectiveProxy = null) {
  const config = OAUTH_TEST_CONFIG[connection.provider];
  if (!config) return { valid: false, error: "Provider test not supported", refreshed: false };
  if (!connection.accessToken) return { valid: false, error: "No access token", refreshed: false };

  // Cursor uses protobuf API - can only verify token exists, not test endpoint
  if (config.tokenExists) {
    return { valid: true, error: null, refreshed: false, newTokens: null };
  }

  let accessToken = connection.accessToken;
  let refreshed = false;
  let newTokens = null;

  const tokenExpired = isTokenExpired(connection);
  if (config.refreshable && tokenExpired && connection.refreshToken) {
    const tokens = await refreshOAuthToken(connection);
    if (tokens) {
      accessToken = tokens.accessToken;
      refreshed = true;
      newTokens = tokens;
    } else {
      return { valid: false, error: "Token expired and refresh failed", refreshed: false };
    }
  }

  if (config.checkExpiry) {
    if (refreshed) return { valid: true, error: null, refreshed, newTokens };
    if (tokenExpired) return { valid: false, error: "Token expired", refreshed: false };
    return { valid: true, error: null, refreshed: false, newTokens: null };
  }

  if (connection.provider === "gemini-cli" || connection.provider === "antigravity") {
    const initial = await probeCloudCodeAssistAccess(connection, accessToken, effectiveProxy);
    if (initial.valid) return { valid: true, error: null, refreshed, newTokens };

    if (initial.status === 401 && config.refreshable && !refreshed && connection.refreshToken) {
      const tokens = await refreshOAuthToken(connection);
      if (tokens?.accessToken) {
        const retry = await probeCloudCodeAssistAccess(connection, tokens.accessToken, effectiveProxy);
        if (retry.valid) return { valid: true, error: null, refreshed: true, newTokens: tokens };
        return { valid: false, error: retry.error, refreshed: true, newTokens: tokens };
      }
      return { valid: false, error: "Token invalid or revoked", refreshed: false };
    }

    return { valid: false, error: initial.error, refreshed };
  }

  // Generic HTTP probe for configured OAuth providers (GitHub, KiloCode,
  // Grok CLI, and similar). `config` was validated at the start of this function.
  try {
    const testUrl = config.buildUrl ? config.buildUrl(accessToken) : config.url;
    const headers = config.noAuth
      ? { ...config.extraHeaders }
      : { [config.authHeader]: `${config.authPrefix}${accessToken}`, ...config.extraHeaders };
    const fetchOpts = { method: config.method, headers };
    if (config.body) fetchOpts.body = config.body;
    const res = await fetchWithConnectionProxy(testUrl, fetchOpts, effectiveProxy);
    const bodyText = !res.ok ? await res.text().catch(() => "") : "";

    const classified = classifyOAuthProbeResult(res, config, bodyText);
    if (classified.valid) {
      return {
        valid: true,
        // soft success surfaces warning text without marking connection error
        error: classified.soft ? classified.error : null,
        warning: classified.soft ? classified.error : null,
        refreshed,
        newTokens,
      };
    }

    if (res.status === 401 && config.refreshable && !refreshed && connection.refreshToken) {
      const tokens = await refreshOAuthToken(connection);
      if (tokens) {
        const retryUrl = config.buildUrl ? config.buildUrl(tokens.accessToken) : testUrl;
        const retryHeaders = config.noAuth
          ? { ...config.extraHeaders }
          : { [config.authHeader]: `${config.authPrefix}${tokens.accessToken}`, ...config.extraHeaders };
        const retryOpts = { method: config.method, headers: retryHeaders };
        if (config.body) retryOpts.body = config.body;
        const retryRes = await fetchWithConnectionProxy(retryUrl, retryOpts, effectiveProxy);
        const retryBody = !retryRes.ok ? await retryRes.text().catch(() => "") : "";
        const retryClassified = classifyOAuthProbeResult(retryRes, config, retryBody);
        if (retryClassified.valid) {
          return {
            valid: true,
            error: retryClassified.soft ? retryClassified.error : null,
            warning: retryClassified.soft ? retryClassified.error : null,
            refreshed: true,
            newTokens: tokens,
          };
        }
      }
      return { valid: false, error: "Token invalid or revoked", refreshed: false };
    }

    return { valid: false, error: classified.error, refreshed };
  } catch (err) {
    return { valid: false, error: err.message, refreshed };
  }
}

async function fetchWithConnectionProxy(url, options = {}, effectiveProxy = null) {
  if (!effectiveProxy?.connectionProxyEnabled || !effectiveProxy?.connectionProxyUrl) {
    return fetch(url, options);
  }

  const { proxyAwareFetch } = await import("open-sse/utils/proxyFetch.js");
  return proxyAwareFetch(url, options, {
    connectionProxyEnabled: true,
    connectionProxyUrl: effectiveProxy.connectionProxyUrl,
    connectionNoProxy: effectiveProxy.connectionNoProxy || "",
  });
}

async function testApiKeyConnection(connection, effectiveProxy = null) {
  if (isOpenAICompatibleProvider(connection.provider)) {
    const modelsBase = connection.providerSpecificData?.baseUrl;
    if (!modelsBase) return { valid: false, error: "Missing base URL" };
    try {
      const res = await fetchWithConnectionProxy(`${modelsBase.replace(/\/$/, "")}/models`, {
        headers: { "Authorization": `Bearer ${connection.apiKey}` },
      }, effectiveProxy);
      return { valid: res.ok, error: res.ok ? null : "Invalid API key or base URL" };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  if (isAnthropicCompatibleProvider(connection.provider)) {
    let modelsBase = connection.providerSpecificData?.baseUrl;
    if (!modelsBase) return { valid: false, error: "Missing base URL" };
    try {
      modelsBase = modelsBase.replace(/\/$/, "");
      if (modelsBase.endsWith("/messages")) modelsBase = modelsBase.slice(0, -9);
      const messagesUrl = `${modelsBase}/v1/messages`;
      const model = connection.defaultModel || "claude-3-haiku-20240307";
      const res = await fetchWithConnectionProxy(messagesUrl, {
        method: "POST",
        headers: {
          "x-api-key": connection.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "Authorization": `Bearer ${connection.apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 1,
          messages: [{ role: "user", content: "test" }],
        }),
      }, effectiveProxy);
      // 400/529 still confirms key accepted; only 401/403 = bad key
      const valid = res.status !== 401 && res.status !== 403;
      return { valid, error: valid ? null : "Invalid API key or base URL" };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  try {
    switch (connection.provider) {
      case "openai": {
        const res = await fetchWithConnectionProxy("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "vilao": {
        // ViLao is a P2P marketplace: the gateway host can differ per key, so a
        // custom endpoint from the user's API Keys page wins over the default.
        const url = resolveVilaoConnectionEndpoint(connection, VILAO_MODELS_PATH);
        const baseUrl = url.replace(/\/models$/, "");
        const started = Date.now();
        let health = "unknown";
        try {
          const healthRes = await fetchWithConnectionProxy(
            `${baseUrl}/health`,
            { signal: AbortSignal.timeout(5000) },
            effectiveProxy,
          );
          if (healthRes.ok) {
            try {
              const h = await healthRes.json();
              health = h?.status || "healthy";
            } catch {
              health = "healthy";
            }
          } else {
            health = "down";
          }
        } catch {
          health = "unknown";
        }

        const res = await fetchWithConnectionProxy(url, {
          headers: { Authorization: `Bearer ${connection.apiKey}` },
          signal: AbortSignal.timeout(15000),
        }, effectiveProxy);
        const latencyMs = Date.now() - started;

        // 402 = key authenticated but wallet empty; that is still a valid key.
        if (res.status === 402) {
          return {
            valid: true,
            error: null,
            warning: "Wallet empty (HTTP 402)",
            meta: {
              keyValid: true,
              walletEmpty: true,
              health,
              modelCount: 0,
              baseUrl,
              latencyMs,
              httpStatus: 402,
            },
          };
        }
        if (!res.ok) {
          return {
            valid: false,
            error: res.status === 401 ? "Invalid API key" : `ViLao probe failed (${res.status})`,
            meta: {
              keyValid: false,
              walletEmpty: false,
              health,
              modelCount: 0,
              baseUrl,
              latencyMs,
              httpStatus: res.status,
            },
          };
        }

        let modelCount = 0;
        try {
          const data = await res.json();
          const list = Array.isArray(data) ? data : (data?.data || data?.models || []);
          modelCount = Array.isArray(list) ? list.length : 0;
        } catch {
          modelCount = 0;
        }
        return {
          valid: true,
          error: null,
          meta: {
            keyValid: true,
            walletEmpty: false,
            health,
            modelCount,
            baseUrl,
            latencyMs,
            httpStatus: 200,
          },
        };
      }
      case "anthropic": {
        const res = await fetchWithConnectionProxy("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "claude-3-haiku-20240307", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        }, effectiveProxy);
        const valid = res.status !== 401;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "gemini": {
        const res = await fetchWithConnectionProxy(`https://generativelanguage.googleapis.com/v1/models?key=${connection.apiKey}`, {}, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "openrouter": {
        const res = await fetchWithConnectionProxy("https://openrouter.ai/api/v1/auth/key", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "glm": {
        const res = await fetchWithConnectionProxy("https://api.z.ai/api/anthropic/v1/messages", {
          method: "POST",
          headers: { "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "glm-4.7", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "minimax": {
        const res = await fetchWithConnectionProxy("https://api.minimax.io/anthropic/v1/messages", {
          method: "POST",
          headers: { "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "minimax-m2", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "kimi": {
        const res = await fetchWithConnectionProxy("https://api.kimi.com/coding/v1/messages", {
          method: "POST",
          headers: { "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "kimi-latest", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "deepseek": {
        const res = await fetchWithConnectionProxy("https://api.deepseek.com/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "groq": {
        const res = await fetchWithConnectionProxy("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "mistral": {
        const res = await fetchWithConnectionProxy("https://api.mistral.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "xai": {
        const res = await fetchWithConnectionProxy("https://api.x.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "ollama": {
        const res = await fetch("https://ollama.com/api/tags", { headers: { Authorization: `Bearer ${connection.apiKey}` } });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "ollama-local": {
        const host = resolveOllamaLocalHost(connection);
        const res = await fetch(`${host}/api/tags`);
        return { valid: res.ok, error: res.ok ? null : `Ollama not reachable at ${host}` };
      }
      case "grok-web": {
        const token = connection.apiKey.startsWith("sso=") ? connection.apiKey.slice(4) : connection.apiKey;
        const randomHex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
        const statsigId = Buffer.from("e:TypeError: Cannot read properties of null (reading 'children')").toString("base64");
        const res = await fetchWithConnectionProxy("https://grok.com/rest/app-chat/conversations/new", {
          method: "POST",
          headers: {
            Accept: "*/*", "Content-Type": "application/json",
            Cookie: `sso=${token}`, Origin: "https://grok.com", Referer: "https://grok.com/",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
            "x-statsig-id": statsigId, "x-xai-request-id": crypto.randomUUID(),
            traceparent: `00-${randomHex(16)}-${randomHex(8)}-00`,
          },
          body: JSON.stringify({ temporary: true, modelName: "grok-4", message: "ping", fileAttachments: [], imageAttachments: [], disableSearch: false, enableImageGeneration: false, sendFinalMetadata: true }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid SSO cookie" };
      }

      case "opencode-go": {
        const res = await fetchWithConnectionProxy("https://opencode.ai/zen/go/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${connection.apiKey}` },
          body: JSON.stringify({ model: getDefaultModel("opencode-go"), messages: [{ role: "user", content: "ping" }], max_tokens: 1, stream: false }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "xiaomi-mimo":
      case "xiaomi-tokenplan": {
        const baseUrls = { "xiaomi-mimo": "https://api.xiaomimimo.com/v1", "xiaomi-tokenplan": "https://token-plan-sgp.xiaomimimo.com/v1" };
        const res = await fetchWithConnectionProxy(`${baseUrls[connection.provider]}/models`, {
          headers: { Authorization: `Bearer ${connection.apiKey}` },
        }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "stepfun": {
        const url = resolveStepFunEndpoints(connection).models;
        const res = await fetchWithConnectionProxy(url, {
          headers: { Authorization: `Bearer ${connection.apiKey}` },
          signal: AbortSignal.timeout(8000),
        }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid StepFun API key" };
      }
      default:
        return { valid: false, error: "Provider test not supported" };
    }
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * Test a single connection by ID, update DB, and return result.
 */
export async function testSingleConnection(id) {
  const connection = await getProviderConnectionById(id);
  if (!connection) return { valid: false, error: "Connection not found", latencyMs: 0, testedAt: new Date().toISOString() };

  const effectiveProxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});

  if (effectiveProxy.connectionProxyEnabled && effectiveProxy.connectionProxyUrl) {
    const proxyResult = await testProxyUrl({ proxyUrl: effectiveProxy.connectionProxyUrl });
    if (!proxyResult.ok) {
      const proxyError = proxyResult.error || `Proxy test failed with status ${proxyResult.status}`;
      await updateProviderConnection(id, {
        testStatus: "error",
        lastError: proxyError,
        lastErrorAt: new Date().toISOString(),
      });
      return { valid: false, error: proxyError, latencyMs: 0, testedAt: new Date().toISOString() };
    }
  }

  const start = Date.now();
  let result;

  if (connection.authType === "apikey" || connection.authType === "cookie") {
    result = await testApiKeyConnection(connection, effectiveProxy);
  } else {
    result = await testOAuthConnection(connection, effectiveProxy);
  }

  const latencyMs = Date.now() - start;

  // Soft success (e.g. Grok CLI 402 spending-limit): credentials are good, account is
  // out of credits. Keep testStatus active; surface the message as lastError so the
  // dashboard can show a warning without marking the connection broken.
  const softWarning = result.valid && (result.warning || result.error);
  const updateData = {
    testStatus: result.valid ? "active" : "error",
    lastError: result.valid ? (softWarning || null) : result.error,
    lastErrorAt: result.valid
      ? softWarning
        ? new Date().toISOString()
        : null
      : new Date().toISOString(),
  };

  if (result.refreshed && result.newTokens) {
    if (result.newTokens.accessToken) updateData.accessToken = result.newTokens.accessToken;
    if (result.newTokens.refreshToken) updateData.refreshToken = result.newTokens.refreshToken;
    if (result.newTokens.idToken) updateData.idToken = result.newTokens.idToken;
    if (result.newTokens.lastRefreshAt) updateData.lastRefreshAt = result.newTokens.lastRefreshAt;
    if (result.newTokens.expiresIn) updateData.expiresIn = result.newTokens.expiresIn;
    if (result.newTokens.expiresIn) {
      updateData.expiresAt = new Date(Date.now() + result.newTokens.expiresIn * 1000).toISOString();
    } else if (result.newTokens.expiresAt) {
      updateData.expiresAt = result.newTokens.expiresAt;
    }
    if (result.newTokens.providerSpecificData) {
      updateData.providerSpecificData = {
        ...(connection.providerSpecificData || {}),
        ...result.newTokens.providerSpecificData,
      };
    }
  }

  // Persist lightweight probe snapshot for Vilao (and any future meta-bearing probes)
  // so the dashboard can show model count / wallet state without a second round-trip.
  if (result.meta && typeof result.meta === "object") {
    updateData.providerSpecificData = {
      ...(connection.providerSpecificData || {}),
      ...(updateData.providerSpecificData || {}),
      lastProbe: {
        ...result.meta,
        testedAt: new Date().toISOString(),
      },
    };
  }

  await updateProviderConnection(id, updateData);

  return {
    valid: result.valid,
    error: result.error,
    warning: result.warning || (result.valid ? softWarning : null) || null,
    refreshed: !!result.refreshed,
    latencyMs: result.meta?.latencyMs ?? latencyMs,
    testedAt: new Date().toISOString(),
    ...(result.meta ? { meta: result.meta } : {}),
  };
}
