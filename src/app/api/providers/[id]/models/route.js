import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/models";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { GEMINI_CONFIG } from "@/lib/oauth/constants/oauth";
import { refreshGoogleToken, updateProviderCredentials } from "@/sse/services/tokenRefresh";
import { PROVIDERS, resolveOllamaLocalHost } from "open-sse/config/providers.js";
import { getModelsByProviderId } from "open-sse/config/providerModels.js";
import { ANTIGRAVITY_IDE_USER_AGENT, ANTIGRAVITY_IDE_VERSION, ANTIGRAVITY_OAUTH_CLIENT } from "open-sse/providers/shared.js";

import { resolveQoderModels } from "open-sse/services/qoderModels.js";
import { resolveGrokCliModels } from "open-sse/services/grokCliModels.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { fetchStepFunModels } from "@/sse/services/stepfun.js";
import { resolveVilaoConnectionEndpoint, VILAO_MODELS_PATH } from "open-sse/providers/vilao.js";

const GEMINI_CLI_MODELS_URL = "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";
// Single-source from the registry (transport.usage.quotaApiUrl) so the models
// listing and the quota poller can never drift onto different hosts.
const ANTIGRAVITY_MODELS_URL = PROVIDERS.antigravity?.usage?.quotaApiUrl || GEMINI_CLI_MODELS_URL;

const parseOpenAIStyleModels = (data) => {
  if (Array.isArray(data)) return data;
  return data?.data || data?.models || data?.results || [];
};

const parseGeminiCliModels = (data) => {
  if (Array.isArray(data?.models)) {
    return data.models
      .map((item) => {
        const id = item?.id || item?.model || item?.name;
        if (!id) return null;
        return { id, name: item?.displayName || item?.name || id };
      })
      .filter(Boolean);
  }

  if (data?.models && typeof data.models === "object") {
    return Object.entries(data.models)
      .filter(([, info]) => !info?.isInternal)
      .map(([id, info]) => ({
        id,
        name: info?.displayName || info?.name || id,
      }));
  }

  return [];
};

const appendCodexReviewModels = (models) => models.flatMap((model) => {
  const id = model?.id || model?.slug || model?.model || model?.name;
  if (!id) return [];
  const name = model?.display_name || model?.displayName || model?.name || id;
  const normalized = { ...model, id, name };
  const isChatModel = (model?.type || "llm") !== "image" && !id.toLowerCase().includes("embed");
  if (!isChatModel || id.endsWith("-review")) return [normalized];
  return [
    normalized,
    {
      ...normalized,
      id: `${id}-review`,
      name: `${name} Review`,
      upstreamModelId: id,
      quotaFamily: "review",
    },
  ];
});

const parseCodexModels = (data) => appendCodexReviewModels(parseOpenAIStyleModels(data));

const createOpenAIModelsConfig = (url) => ({
  url,
  method: "GET",
  headers: { "Content-Type": "application/json" },
  authHeader: "Authorization",
  authPrefix: "Bearer ",
  parseResponse: parseOpenAIStyleModels
});

const resolveQwenModelsUrl = (connection) => {
  const fallback = "https://portal.qwen.ai/v1/models";
  const raw = connection?.providerSpecificData?.resourceUrl;
  if (!raw || typeof raw !== "string") return fallback;
  const value = raw.trim();
  if (!value) return fallback;
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return `${value.replace(/\/$/, "")}/models`;
  }
  return `https://${value.replace(/\/$/, "")}/v1/models`;
};

const getStaticProviderModels = (providerId) =>
  getModelsByProviderId(providerId).map((model) => ({
    ...model,
    id: model.id,
    name: model.name || model.id,
  }));

// Generic custom resolver for OAuth providers that need refresh-on-401 + token persist.
// Receives a `fetchFn(token)` and returns parsed models or throws.
const buildOAuthResolver = ({ refreshFn, fetchFn, parseFn, errorLabel }) => async (connection) => {
  const { accessToken, refreshToken } = connection;
  if (!accessToken) {
    return { error: "No valid token found", status: 401 };
  }
  let warning;
  try {
    let response = await fetchFn(accessToken, connection);
    if (!response.ok && (response.status === 401 || response.status === 403) && refreshToken) {
      const refreshed = await refreshFn(connection);
      if (refreshed?.accessToken) {
        await updateProviderCredentials(connection.id, {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken || refreshToken,
          expiresIn: refreshed.expiresIn,
        });
        connection.accessToken = refreshed.accessToken;
        if (refreshed.refreshToken) connection.refreshToken = refreshed.refreshToken;
        response = await fetchFn(refreshed.accessToken, connection);
      }
    }
    if (response.ok) {
      const data = await response.json();
      const models = parseFn(data);
      if (models.length > 0) return { models };
    } else {
      const errorText = await response.text();
      warning = `${errorLabel}: ${response.status} ${errorText}`;
      console.log(`${errorLabel} (falling back to static):`, errorText);
    }
  } catch (error) {
    warning = `${errorLabel}: ${error.message}`;
    console.log(`${errorLabel} (falling back to static):`, error.message);
  }
  return { models: [], warning };
};

// Provider models endpoints configuration
const PROVIDER_MODELS_CONFIG = {
  claude: {
    url: "https://api.anthropic.com/v1/models",
    method: "GET",
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Content-Type": "application/json"
    },
    authHeader: "x-api-key",
    parseResponse: (data) => data.data || []
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authQuery: "key", // Use query param for API key
    parseResponse: (data) => data.models || []
  },
  qwen: {
    url: "https://portal.qwen.ai/v1/models",
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: (data) => data.data || []
  },
  codex: {
    url: "https://chatgpt.com/backend-api/codex/models?client_version=1.0.0",
    method: "GET",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: parseCodexModels
  },
  antigravity: {
    // The old `daily-cloudcode-pa.sandbox.googleapis.com/v1internal:models` host
    // is gone and answers with Google's 404 HTML page, which blew up JSON parsing
    // ("Error fetching models from antigravity: <!DOCTYPE html>"). Use the same
    // production Cloud Code endpoint the quota/usage path already relies on
    // (open-sse/services/usage/google.js → registry transport.usage.quotaApiUrl),
    // with OAuth refresh-on-401 and a static-catalog fallback.
    customResolver: async (connection) => {
      const resolve = buildOAuthResolver({
        refreshFn: (conn) => refreshGoogleToken(conn.refreshToken, ANTIGRAVITY_OAUTH_CLIENT.clientId, ANTIGRAVITY_OAUTH_CLIENT.clientSecret),
        fetchFn: (token, conn) => {
          const projectId = conn.projectId || conn.providerSpecificData?.projectId;
          return fetch(ANTIGRAVITY_MODELS_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`,
              "User-Agent": ANTIGRAVITY_IDE_USER_AGENT,
              "X-Client-Name": "antigravity",
              "X-Client-Version": ANTIGRAVITY_IDE_VERSION,
            },
            body: JSON.stringify(projectId ? { project: projectId } : {}),
          });
        },
        parseFn: parseGeminiCliModels,
        errorLabel: "Failed to fetch Antigravity models",
      });

      const result = await resolve(connection);
      if (result.error) return result;
      // Antigravity's catalog is curated in the registry; keep the UI populated
      // when the upstream call fails or returns an empty list.
      if (!result.models?.length) {
        return { models: getStaticProviderModels("antigravity"), ...(result.warning ? { warning: result.warning } : {}) };
      }
      return result;
    },
  },
  github: {
    url: "https://api.githubcopilot.com/models",
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "Copilot-Integration-Id": "vscode-chat",
      "editor-version": "vscode/1.107.1",
      "editor-plugin-version": "copilot-chat/0.26.7",
      "user-agent": "GitHubCopilotChat/0.26.7"
    },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: (data) => {
      if (!data?.data) return [];
      // Filter out embeddings, non-chat models, and disabled models
      return data.data
        .filter(m => m.capabilities?.type === "chat")
        .filter(m => m.policy?.state !== "disabled") // Only return explicitly enabled models
        .map(m => ({
          id: m.id,
          name: m.name || m.id,
          version: m.version,
          capabilities: m.capabilities,
          isDefault: m.model_picker_enabled === true
        }));
    }
  },
  openai: createOpenAIModelsConfig("https://api.openai.com/v1/models"),
  openrouter: createOpenAIModelsConfig("https://openrouter.ai/api/v1/models"),
  stepfun: {
    customResolver: async (connection) => {
      const result = await fetchStepFunModels(connection);
      return {
        models: result.models || [],
        ...(result.warning ? { warning: result.warning } : {}),
      };
    },
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/models",
    method: "GET",
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Content-Type": "application/json"
    },
    authHeader: "x-api-key",
    parseResponse: (data) => data.data || []
  },

  // OpenAI-compatible API key providers
  deepseek: createOpenAIModelsConfig("https://api.deepseek.com/models"),
  groq: createOpenAIModelsConfig("https://api.groq.com/openai/v1/models"),
  xai: createOpenAIModelsConfig("https://api.x.ai/v1/models"),
  mistral: createOpenAIModelsConfig("https://api.mistral.ai/v1/models"),
  ollama: createOpenAIModelsConfig("https://ollama.com/api/tags"),
  // ollama-local: url resolved dynamically below via providerSpecificData.baseUrl
  vilao: {
    // P2P marketplace: model ids are the aliases the user configured on their key,
    // and the gateway host itself can be overridden per key.
    customResolver: async (connection) => {
      const url = resolveVilaoConnectionEndpoint(connection, VILAO_MODELS_PATH);
      const started = Date.now();
      let res;
      try {
        const proxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});
        if (proxy.connectionProxyEnabled && proxy.connectionProxyUrl) {
          const { proxyAwareFetch } = await import("open-sse/utils/proxyFetch.js");
          res = await proxyAwareFetch(url, {
            headers: { Authorization: `Bearer ${connection.apiKey}`, "Content-Type": "application/json" },
            signal: AbortSignal.timeout(20000),
          }, {
            connectionProxyEnabled: true,
            connectionProxyUrl: proxy.connectionProxyUrl,
            connectionNoProxy: proxy.connectionNoProxy || "",
          });
        } else {
          res = await fetch(url, {
            headers: { Authorization: `Bearer ${connection.apiKey}`, "Content-Type": "application/json" },
            signal: AbortSignal.timeout(20000),
          });
        }
      } catch (err) {
        return {
          error: err.name === "TimeoutError" ? "ViLao models request timed out" : (err.message || "Network error"),
          status: 502,
          meta: {
            keyValid: false,
            walletEmpty: false,
            baseUrl: url.replace(/\/models$/, ""),
            latencyMs: Date.now() - started,
            modelCount: 0,
          },
        };
      }

      const latencyMs = Date.now() - started;
      const baseUrl = url.replace(/\/models$/, "");
      // 402 = key authenticated but wallet empty — still a valid key, empty catalog.
      if (res.status === 402) {
        return {
          models: [],
          warning: "ViLao key is valid but the wallet is empty (HTTP 402).",
          meta: {
            keyValid: true,
            walletEmpty: true,
            baseUrl,
            latencyMs,
            modelCount: 0,
            httpStatus: 402,
          },
        };
      }
      if (!res.ok) {
        let detail = "";
        try {
          const body = await res.json();
          detail = body?.error?.message || body?.message || "";
        } catch {
          detail = "";
        }
        return {
          error: detail ? `Failed to fetch models: ${res.status} — ${detail}` : `Failed to fetch models: ${res.status}`,
          status: res.status,
          meta: {
            keyValid: res.status !== 401,
            walletEmpty: false,
            baseUrl,
            latencyMs,
            modelCount: 0,
            httpStatus: res.status,
          },
        };
      }

      const data = await res.json();
      const models = parseOpenAIStyleModels(data)
        .map((m) => {
          const id = m?.id || m?.name;
          if (!id) return null;
          return {
            id,
            name: m?.name || m?.id || id,
            contextLength: m?.context_length || m?.contextLength || null,
            ownedBy: m?.owned_by || m?.ownedBy || null,
          };
        })
        .filter(Boolean);
      return {
        models,
        meta: {
          keyValid: true,
          walletEmpty: false,
          baseUrl,
          latencyMs,
          modelCount: models.length,
          httpStatus: 200,
        },
      };
    },
  },

  // Custom resolvers (non-OpenAI-shaped APIs / token-refresh flows)
  qoder: {
    customResolver: async (connection) => {
      const credentials = {
        accessToken: connection.accessToken,
        refreshToken: connection.refreshToken,
        email: connection.email,
        displayName: connection.displayName,
        providerSpecificData: connection.providerSpecificData || {},
      };
      let warning;
      try {
        const result = await resolveQoderModels(credentials, { forceRefresh: true });
        if (result?.models?.length) {
          return {
            models: result.models.map((m) => ({
              // Use the canonical "qoder/<key>" id so the dashboard
              // surfaces the same identifier the chat router expects.
              id: `qoder/${m.id}`,
              name: m.name,
              contextLength: m.contextLength,
              isVL: m.isVL,
              isReasoning: m.isReasoning,
              maxOutputTokens: m.maxOutputTokens,
              description: m.description,
            })),
          };
        }
        warning = "Qoder returned no models; falling back to static catalog.";
      } catch (error) {
        warning = `Failed to fetch Qoder models: ${error.message}`;
        console.log("Failed to fetch Qoder models dynamically, falling back to static:", error.message);
      }
      return { models: [], warning };
    },
  },
  "gemini-cli": {
    customResolver: buildOAuthResolver({
      refreshFn: (conn) => refreshGoogleToken(conn.refreshToken, GEMINI_CONFIG.clientId, GEMINI_CONFIG.clientSecret),
      fetchFn: (token, conn) => {
        const projectId = conn.projectId || conn.providerSpecificData?.projectId;
        const body = projectId ? { project: projectId } : {};
        return fetch(GEMINI_CLI_MODELS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
            "User-Agent": "google-api-nodejs-client/9.15.1",
            "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1"
          },
          body: JSON.stringify(body)
        });
      },
      parseFn: parseGeminiCliModels,
      errorLabel: "Failed to fetch Gemini CLI models"
    })
  },
  "grok-cli": {
    customResolver: async (connection) => {
      const proxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});
      const result = await resolveGrokCliModels({
        ...connection,
        connectionId: connection.id,
      }, {
        log: console,
        proxyOptions: {
          connectionProxyEnabled: proxy.connectionProxyEnabled === true,
          connectionProxyUrl: proxy.connectionProxyUrl || "",
          connectionNoProxy: proxy.connectionNoProxy || "",
          strictProxy: proxy.strictProxy === true,
        },
        onCredentialsRefreshed: async (refreshed) => {
          await updateProviderCredentials(connection.id, {
            ...refreshed,
            existingProviderSpecificData: connection.providerSpecificData || {},
          });
        },
      });
      if (result.models.length) return result;
      return {
        models: getStaticProviderModels("grok-cli"),
        warning: result.warning || "Grok CLI returned no live models; using static catalog.",
      };
    },
  },
  "ollama-local": {
    customResolver: async (connection) => {
      const url = `${resolveOllamaLocalHost(connection)}/api/tags`;
      const response = await fetch(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.log("Error fetching models from ollama-local:", errorText);
        return { error: `Failed to fetch models: ${response.status}`, status: response.status };
      }
      const data = await response.json();
      return { models: parseOpenAIStyleModels(data) };
    }
  }
};

/**
 * GET /api/providers/[id]/models - Get models list from provider
 */
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    if (isOpenAICompatibleProvider(connection.provider)) {
      const baseUrl = connection.providerSpecificData?.baseUrl;
      if (!baseUrl) {
        return NextResponse.json({ error: "No base URL configured for OpenAI compatible provider" }, { status: 400 });
      }
      const url = `${baseUrl.replace(/\/$/, "")}/models`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${connection.apiKey}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`Error fetching models from ${connection.provider}:`, errorText);
        return NextResponse.json(
          { error: `Failed to fetch models: ${response.status}` },
          { status: response.status }
        );
      }

      const data = await response.json();
      const models = data.data || data.models || [];

      return NextResponse.json({
        provider: connection.provider,
        connectionId: connection.id,
        models
      });
    }

    if (isAnthropicCompatibleProvider(connection.provider)) {
      let baseUrl = connection.providerSpecificData?.baseUrl;
      if (!baseUrl) {
        return NextResponse.json({ error: "No base URL configured for Anthropic compatible provider" }, { status: 400 });
      }

      baseUrl = baseUrl.replace(/\/$/, "");
      if (baseUrl.endsWith("/messages")) {
        baseUrl = baseUrl.slice(0, -9);
      }

      const url = `${baseUrl}/models`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": connection.apiKey,
          "anthropic-version": "2023-06-01",
          "Authorization": `Bearer ${connection.apiKey}`
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`Error fetching models from ${connection.provider}:`, errorText);
        return NextResponse.json(
          { error: `Failed to fetch models: ${response.status}` },
          { status: response.status }
        );
      }

      const data = await response.json();
      const models = data.data || data.models || [];

      return NextResponse.json({
        provider: connection.provider,
        connectionId: connection.id,
        models
      });
    }

    const config = PROVIDER_MODELS_CONFIG[connection.provider];
    if (!config) {
      return NextResponse.json(
        { error: `Provider ${connection.provider} does not support models listing` },
        { status: 400 }
      );
    }

    // Config-driven custom resolver path (OAuth refresh, non-OpenAI shape, etc.)
    if (typeof config.customResolver === "function") {
      const result = await config.customResolver(connection);
      if (result.error) {
        return NextResponse.json({
          error: result.error,
          ...(result.meta ? { meta: result.meta } : {}),
        }, { status: result.status || 500 });
      }
      return NextResponse.json({
        provider: connection.provider,
        connectionId: connection.id,
        models: result.models,
        ...(result.warning ? { warning: result.warning } : {}),
        ...(result.meta ? { meta: result.meta } : {}),
      });
    }

    // Get auth token
    const token = connection.providerSpecificData?.copilotToken || connection.accessToken || connection.apiKey;
    if (!token) {
      return NextResponse.json({ error: "No valid token found" }, { status: 401 });
    }

    // Build request URL
    let url = config.url;
    if (connection.provider === "qwen") {
      url = resolveQwenModelsUrl(connection);
    }
    if (config.authQuery) {
      url += `?${config.authQuery}=${token}`;
    }

    // Build headers
    const headers = { ...config.headers };
    if (config.authHeader && !config.authQuery) {
      headers[config.authHeader] = (config.authPrefix || "") + token;
    }

    // Make request
    const fetchOptions = {
      method: config.method,
      headers
    };

    if (config.body && config.method === "POST") {
      fetchOptions.body = JSON.stringify(config.body);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`Error fetching models from ${connection.provider}:`, errorText);
      return NextResponse.json(
        { error: `Failed to fetch models: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const models = config.parseResponse(data);

    return NextResponse.json({
      provider: connection.provider,
      connectionId: connection.id,
      models
    });
  } catch (error) {
    console.log("Error fetching provider models:", error);
    return NextResponse.json({ error: "Failed to fetch models" }, { status: 500 });
  }
}
