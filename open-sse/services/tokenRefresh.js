import { PROVIDERS } from "../config/providers.js";
import { OAUTH_ENDPOINTS, REFRESH_LEAD_MS } from "../config/appConstants.js";
import {
  refreshXaiToken,
  refreshAccessToken,
  refreshClaudeOAuthToken,
  refreshGoogleToken,
  refreshQwenToken,
  refreshCodexToken,
  refreshGitHubToken,
  refreshCopilotToken,
  classifyOAuthRefreshError,
} from "./tokenRefresh/providers.js";

// Re-export all provider refresh functions (preserves public API for all consumers)
export {
  refreshAccessToken,
  refreshClaudeOAuthToken,
  refreshGoogleToken,
  refreshQwenToken,
  refreshCodexToken,
  refreshGitHubToken,
  refreshCopilotToken,
  classifyOAuthRefreshError,
};

export const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export function isUnrecoverableRefreshError(result) {
  return (
    result &&
    typeof result === "object" &&
    (result.error === "unrecoverable_refresh_error" ||
      result.error === "refresh_token_reused" ||
      result.error === "invalid_request" ||
      result.error === "invalid_grant")
  );
}

export function getRefreshLeadMs(provider) {
  return REFRESH_LEAD_MS[provider] || TOKEN_EXPIRY_BUFFER_MS;
}

const REFRESH_HANDLERS = {
  "gemini-cli": (c, log) => refreshGoogleToken(c.refreshToken, PROVIDERS["gemini-cli"].clientId, PROVIDERS["gemini-cli"].clientSecret, log),
  antigravity: (c, log) => refreshGoogleToken(c.refreshToken, PROVIDERS.antigravity.clientId, PROVIDERS.antigravity.clientSecret, log),
  claude: (c, log) => refreshClaudeOAuthToken(c.refreshToken, log),
  codex: (c, log) => refreshCodexToken(c.refreshToken, log),
  qwen: (c, log) => refreshQwenToken(c.refreshToken, log),
  github: (c, log) => refreshGitHubToken(c.refreshToken, log),
  xai: (c, log) => refreshXaiToken(c.refreshToken, log),
  // Grok CLI shares xAI OAuth client + token endpoint (device-code tokens refresh the same way)
  "grok-cli": (c, log) => refreshXaiToken(c.refreshToken, log),
  gcli: (c, log) => refreshXaiToken(c.refreshToken, log),
};

export async function getAccessToken(provider, credentials, log) {
  if (!credentials || !credentials.refreshToken || typeof credentials.refreshToken !== "string") {
    log?.warn?.("TOKEN_REFRESH", `No valid refresh token available for provider: ${provider}`);
    return null;
  }
  return _getAccessTokenInternal(provider, credentials, log);
}

async function _getAccessTokenInternal(provider, credentials, log) {
  if (provider === "gemini") {
    return refreshGoogleToken(credentials.refreshToken, PROVIDERS.gemini.clientId, PROVIDERS.gemini.clientSecret, log);
  }
  const handler = REFRESH_HANDLERS[provider];
  if (!handler) {
    log?.warn?.("TOKEN_REFRESH", `Unsupported provider for token refresh: ${provider}`);
    return null;
  }
  return handler(credentials, log);
}

export async function refreshTokenByProvider(provider, credentials, log) {
  if (!credentials.refreshToken) return null;
  const handler = REFRESH_HANDLERS[provider];
  return handler ? handler(credentials, log) : refreshAccessToken(provider, credentials.refreshToken, credentials, log);
}

export function formatProviderCredentials(provider, credentials, log) {
  const config = PROVIDERS[provider];
  if (!config) {
    log?.warn?.("TOKEN_REFRESH", `No configuration found for provider: ${provider}`);
    return null;
  }

  switch (provider) {
    case "gemini":
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken,
        projectId: credentials.projectId
      };

    case "claude":
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken
      };

    case "codex":
    case "qwen":
    case "openai":
    case "openrouter":
    case "xai":
    case "grok-cli":
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken
      };

    case "antigravity":
    case "gemini-cli":
      return {
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        projectId: credentials.projectId
      };

    default:
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken
      };
  }
}

export async function getAllAccessTokens(userInfo, log) {
  const results = {};

  if (userInfo.connections && Array.isArray(userInfo.connections)) {
    for (const connection of userInfo.connections) {
      if (connection.isActive && connection.provider) {
        const token = await getAccessToken(connection.provider, {
          refreshToken: connection.refreshToken
        }, log);

        if (token) {
          results[connection.provider] = token;
        }
      }
    }
  }

  return results;
}

export async function refreshWithRetry(refreshFn, maxRetries = 3, log = null) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = attempt * 1000;
      log?.debug?.("TOKEN_REFRESH", `Retry ${attempt}/${maxRetries} after ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }

    try {
      const result = await refreshFn();
      if (result) return result;
    } catch (error) {
      log?.warn?.("TOKEN_REFRESH", `Attempt ${attempt + 1}/${maxRetries} failed: ${error.message}`);
    }
  }

  log?.error?.("TOKEN_REFRESH", `All ${maxRetries} retry attempts failed`);
  return null;
}
