/**
 * OAuth Provider Configurations and Handlers
 * Centralized DRY approach for all OAuth providers
 */

// Ensure outbound fetch respects HTTP(S)_PROXY/ALL_PROXY in Node runtime
import "../../../open-sse/index.js";
import crypto from "crypto";

import { generatePKCE, generateState } from "./utils/pkce";
import {
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  QWEN_CONFIG,
  ANTIGRAVITY_CONFIG,
  GITHUB_CONFIG,
  CURSOR_CONFIG,
  KIMI_CODING_CONFIG,
  KILOCODE_CONFIG,
  GROK_CLI_CONFIG,
  getOAuthClientMetadata,
} from "./constants/oauth";
import { XAI_CONFIG, XAI_PKCE_VERIFIER_BYTES } from "./constants/xai";
import {
  validateXaiOAuthEndpoint,
  decodeXaiIdTokenEmail,
  extractEmailFromAccessToken,
  extractCodexAccountInfo,
} from "./providerHelpers";

export { extractCodexAccountInfo };

// Inlined from services/xai.js to keep web route bundle free of `open` (CLI-only) package
let cachedXaiDiscovery = null;

async function discoverXaiEndpoints() {
  if (cachedXaiDiscovery) return cachedXaiDiscovery;
  try {
    const res = await fetch(XAI_CONFIG.discoveryUrl, { headers: { Accept: "application/json" } });
    if (res.ok) {
      const data = await res.json();
      cachedXaiDiscovery = {
        authorizeUrl: validateXaiOAuthEndpoint(data.authorization_endpoint, "authorization_endpoint"),
        tokenUrl: validateXaiOAuthEndpoint(data.token_endpoint, "token_endpoint"),
      };
      return cachedXaiDiscovery;
    }
  } catch { /* fall through to static fallback */ }
  cachedXaiDiscovery = { authorizeUrl: XAI_CONFIG.authorizeUrl, tokenUrl: XAI_CONFIG.tokenUrl };
  return cachedXaiDiscovery;
}

// Provider configurations
const PROVIDERS = {
  claude: {
    config: CLAUDE_CONFIG,
    flowType: "authorization_code_pkce",
    buildAuthUrl: (config, redirectUri, state, codeChallenge) => {
      const params = new URLSearchParams({
        code: "true",
        client_id: config.clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: config.scopes.join(" "),
        code_challenge: codeChallenge,
        code_challenge_method: config.codeChallengeMethod,
        state: state,
      });
      return `${config.authorizeUrl}?${params.toString()}`;
    },
    exchangeToken: async (config, code, redirectUri, codeVerifier, state) => {
      // Parse code - may contain state after #
      let authCode = code;
      let codeState = "";
      if (authCode.includes("#")) {
        const parts = authCode.split("#");
        authCode = parts[0];
        codeState = parts[1] || "";
      }

      const response = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          code: authCode,
          state: codeState || state,
          grant_type: "authorization_code",
          client_id: config.clientId,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token exchange failed: ${error}`);
      }

      return await response.json();
    },
    mapTokens: (tokens) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      scope: tokens.scope,
    }),
  },

  codex: {
    config: CODEX_CONFIG,
    flowType: "authorization_code_pkce",
    fixedPort: CODEX_CONFIG.fixedPort,
    callbackPath: CODEX_CONFIG.callbackPath,
    buildAuthUrl: (config, redirectUri, state, codeChallenge) => {
      const params = {
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: redirectUri,
        scope: config.scope,
        code_challenge: codeChallenge,
        code_challenge_method: config.codeChallengeMethod,
        ...config.extraParams,
        state: state,
      };
      const queryString = Object.entries(params)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join("&");
      return `${config.authorizeUrl}?${queryString}`;
    },
    exchangeToken: async (config, code, redirectUri, codeVerifier) => {
      const response = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.clientId,
          code: code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token exchange failed: ${error}`);
      }

      return await response.json();
    },
    mapTokens: (tokens) => {
      const info = extractCodexAccountInfo(tokens.id_token);
      const mapped = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token,
        expiresIn: tokens.expires_in,
        lastRefreshAt: new Date().toISOString(),
      };
      const email = info.email || extractEmailFromAccessToken(tokens.access_token);
      if (email) mapped.email = email;
      if (info.chatgptAccountId || info.chatgptPlanType) {
        mapped.providerSpecificData = {
          chatgptAccountId: info.chatgptAccountId,
          chatgptPlanType: info.chatgptPlanType,
        };
      }
      return mapped;
    },
  },

  xai: {
    config: XAI_CONFIG,
    flowType: "authorization_code_pkce",
    fixedPort: XAI_CONFIG.loopbackPort,
    callbackPath: XAI_CONFIG.callbackPath,
    pkceVerifierBytes: XAI_PKCE_VERIFIER_BYTES,
    prepareConfig: async (config) => {
      const endpoints = await discoverXaiEndpoints();
      return {
        ...config,
        authorizeUrl: endpoints.authorizeUrl,
        tokenUrl: endpoints.tokenUrl,
      };
    },
    buildAuthUrl: (config, redirectUri, state, codeChallenge) => {
      // Mirror CLIProxyAPI BuildAuthorizeURL: includes nonce, plan, referrer
      const nonce = crypto.randomBytes(16).toString("hex");
      const params = {
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: redirectUri,
        scope: config.scope,
        code_challenge: codeChallenge,
        code_challenge_method: config.codeChallengeMethod,
        state,
        nonce,
        plan: "generic",
        referrer: "cli-proxy-api",
      };
      const qs = Object.entries(params)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join("&");
      return `${config.authorizeUrl}?${qs}`;
    },
    exchangeToken: async (config, code, redirectUri, codeVerifier) => {
      const response = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.clientId,
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`xAI token exchange failed: ${error}`);
      }
      return await response.json();
    },
    mapTokens: (tokens) => {
      const mapped = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        scope: tokens.scope,
      };
      const email = decodeXaiIdTokenEmail(tokens.id_token);
      if (email) mapped.email = email;
      if (tokens.id_token) {
        mapped.providerSpecificData = { idToken: tokens.id_token };
      }
      return mapped;
    },
  },

  // Grok CLI / Grok Build — device code flow to auth.x.ai, inference on cli-chat-proxy.grok.com
  "grok-cli": {
    config: GROK_CLI_CONFIG,
    flowType: "device_code",
    requestDeviceCode: async (config) => {
      const body = new URLSearchParams({
        client_id: config.clientId,
        scope: config.scope,
      });
      // Official CLI sends referrer=grok-build
      if (config.referrer) body.set("referrer", config.referrer);

      const response = await fetch(config.deviceCodeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": "grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)",
        },
        body,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Grok CLI device code request failed: ${error}`);
      }

      return await response.json();
    },
    pollToken: async (config, deviceCode) => {
      const response = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": "grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)",
        },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: config.clientId,
        }),
      });

      let data;
      try {
        data = await response.json();
      } catch {
        const text = await response.text();
        data = { error: "invalid_response", error_description: text };
      }

      // Device flow: 400 + authorization_pending is expected while user authorizes
      const pending =
        data?.error === "authorization_pending" ||
        data?.error === "slow_down";
      return {
        ok: response.ok || pending,
        data,
      };
    },
    postExchange: async (tokens) => {
      // Best-effort user profile from cli-chat-proxy (non-fatal)
      try {
        const res = await fetch("https://cli-chat-proxy.grok.com/v1/user", {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            Accept: "application/json",
            "User-Agent": "grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)",
            "x-xai-token-auth": "xai-grok-cli",
            "x-grok-client-version": "0.2.93",
          },
        });
        if (res.ok) return { user: await res.json() };
      } catch {
        /* ignore */
      }
      return { user: null };
    },
    mapTokens: (tokens, extra) => {
      const email =
        decodeXaiIdTokenEmail(tokens.id_token) ||
        extractEmailFromAccessToken(tokens.access_token) ||
        extra?.user?.email ||
        null;
      const userId =
        extra?.user?.userId ||
        extra?.user?.principalId ||
        null;
      const displayName = [extra?.user?.firstName, extra?.user?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() || null;

      const expiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null;

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresIn: tokens.expires_in,
        // Surface an absolute expiry so the proactive refresh path
        // (shouldRefreshCredentials / checkAndRefreshToken) can refresh the
        // xAI token before it silently expires ~40-45 min after login.
        // Without this, only the reactive 401 path in chatCore would refresh,
        // causing intermittent "token expired" failures for Grok CLI.
        expiresAt,
        scope: tokens.scope,
        // Top-level for dashboard connection cards
        email: email || undefined,
        displayName: displayName || undefined,
        // Mirror identity into providerSpecificData so GrokCliExecutor can set
        // x-email / x-userid without depending on top-level credential shape.
        providerSpecificData: {
          authMethod: "device_code",
          idToken: tokens.id_token || null,
          email: email || null,
          userId,
          hasGrokCodeAccess: extra?.user?.hasGrokCodeAccess ?? null,
          subscriptionTier: extra?.user?.subscriptionTier ?? null,
        },
      };
    },
  },

  antigravity: {
    config: ANTIGRAVITY_CONFIG,
    flowType: "authorization_code",
    buildAuthUrl: (config, redirectUri, state) => {
      const params = new URLSearchParams({
        client_id: config.clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: config.scopes.join(" "),
        state: state,
        access_type: "offline",
        prompt: "consent",
      });
      return `${config.authorizeUrl}?${params.toString()}`;
    },
    exchangeToken: async (config, code, redirectUri) => {
      const response = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code: code,
          redirect_uri: redirectUri,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token exchange failed: ${error}`);
      }

      return await response.json();
    },
    postExchange: async (tokens) => {
      // Numeric enums matching Antigravity binary ClientMetadata
      const loadHeaders = {
        "Authorization": `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
        "User-Agent": ANTIGRAVITY_CONFIG.loadCodeAssistUserAgent,
        "X-Goog-Api-Client": ANTIGRAVITY_CONFIG.loadCodeAssistApiClient,
        "Client-Metadata": ANTIGRAVITY_CONFIG.loadCodeAssistClientMetadata,
        "x-request-source": "local",
      };
      const metadata = getOAuthClientMetadata();

      // Fetch user info
      const userInfoRes = await fetch(`${ANTIGRAVITY_CONFIG.userInfoUrl}?alt=json`, {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          "x-request-source": "local",
        },
      });
      const userInfo = userInfoRes.ok ? await userInfoRes.json() : {};

      // Load Code Assist to get project ID and tier. New Google accounts often have
      // no cloudaicompanionProject yet — we MUST await onboardUser in that case.
      // Previously onboard only ran when projectId was already set (dead path),
      // so new connections saved projectId=null and generateContent used a
      // random fake project → RESOURCE_EXHAUSTED 429.
      let projectId = "";
      let tierId = "legacy-tier";
      try {
        const loadRes = await fetch(ANTIGRAVITY_CONFIG.loadCodeAssistEndpoint, {
          method: "POST",
          headers: loadHeaders,
          body: JSON.stringify({ metadata }),
        });
        if (loadRes.ok) {
          const data = await loadRes.json();
          projectId = data.cloudaicompanionProject?.id || data.cloudaicompanionProject || "";
          if (typeof projectId === "object" && projectId) projectId = projectId.id || "";
          projectId = typeof projectId === "string" ? projectId.trim() : "";
          if (Array.isArray(data.allowedTiers)) {
            for (const tier of data.allowedTiers) {
              if (tier.isDefault && tier.id) {
                tierId = tier.id.trim();
                break;
              }
            }
          }
        } else {
          console.log("loadCodeAssist HTTP", loadRes.status, await loadRes.text().catch(() => ""));
        }
      } catch (e) {
        console.log("Failed to load code assist:", e);
      }

      // Resolve missing project via onboardUser (blocking, short poll).
      if (!projectId) {
        for (let i = 0; i < 8; i++) {
          try {
            const onboardRes = await fetch(ANTIGRAVITY_CONFIG.onboardUserEndpoint, {
              method: "POST",
              headers: loadHeaders,
              body: JSON.stringify({ tierId, metadata }),
            });
            if (onboardRes.ok) {
              const result = await onboardRes.json();
              const pid =
                result?.response?.cloudaicompanionProject?.id
                || result?.response?.cloudaicompanionProject
                || result?.cloudaicompanionProject?.id
                || result?.cloudaicompanionProject
                || "";
              const normalized = typeof pid === "string" ? pid.trim() : (pid?.id || "");
              if (normalized) {
                projectId = normalized;
                break;
              }
              if (result.done === true) break;
            } else {
              console.log("onboardUser HTTP", onboardRes.status);
              break;
            }
          } catch (e) {
            console.error("onboardUser error:", e?.message || e);
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } else {
        // Project already exists — best-effort background onboard (legacy behavior)
        const doOnboard = async () => {
          for (let i = 0; i < 5; i++) {
            try {
              const onboardRes = await fetch(ANTIGRAVITY_CONFIG.onboardUserEndpoint, {
                method: "POST",
                headers: loadHeaders,
                body: JSON.stringify({ tierId, metadata }),
              });
              if (onboardRes.ok) {
                const result = await onboardRes.json();
                if (result.done === true) break;
              }
            } catch {
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 5000));
          }
        };
        doOnboard().catch(() => {});
      }

      if (!projectId) {
        console.warn("[antigravity OAuth] No Cloud Code projectId after loadCodeAssist/onboardUser — generate will fail until repaired");
      }

      return { userInfo, projectId };
    },
    mapTokens: (tokens, extra) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      scope: tokens.scope,
      email: extra?.userInfo?.email,
      projectId: extra?.projectId,
    }),
  },

  qwen: {
    config: QWEN_CONFIG,
    flowType: "device_code",
    requestDeviceCode: async (config, codeChallenge) => {
      const response = await fetch(config.deviceCodeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          scope: config.scope,
          code_challenge: codeChallenge,
          code_challenge_method: config.codeChallengeMethod,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Device code request failed: ${error}`);
      }

      return await response.json();
    },
    pollToken: async (config, deviceCode, codeVerifier) => {
      const response = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          client_id: config.clientId,
          device_code: deviceCode,
          code_verifier: codeVerifier,
        }),
      });

      return {
        ok: response.ok,
        data: await response.json(),
      };
    },
    mapTokens: (tokens) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      providerSpecificData: { resourceUrl: tokens.resource_url },
    }),
  },

  github: {
    config: GITHUB_CONFIG,
    flowType: "device_code",
    requestDeviceCode: async (config) => {
      const response = await fetch(config.deviceCodeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          scope: config.scopes,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Device code request failed: ${error}`);
      }

      return await response.json();
    },
    pollToken: async (config, deviceCode) => {
      const response = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });

      // Handle response properly - if not ok, try to get error as text first
      let data;
      try {
        data = await response.json();
      } catch (e) {
        // If response is not JSON, get as text
        const text = await response.text();
        data = { error: "invalid_response", error_description: text };
      }

      return {
        ok: response.ok,
        data: data,
      };
    },
    postExchange: async (tokens) => {
      // Get Copilot token using GitHub access token
      const copilotRes = await fetch(GITHUB_CONFIG.copilotTokenUrl, {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: "application/json",
          "X-GitHub-Api-Version": GITHUB_CONFIG.apiVersion,
          "User-Agent": GITHUB_CONFIG.userAgent,
        },
      });
      const copilotToken = copilotRes.ok ? await copilotRes.json() : {};

      // Get user info from GitHub
      const userRes = await fetch(GITHUB_CONFIG.userInfoUrl, {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: "application/json",
          "X-GitHub-Api-Version": GITHUB_CONFIG.apiVersion,
          "User-Agent": GITHUB_CONFIG.userAgent,
        },
      });
      const userInfo = userRes.ok ? await userRes.json() : {};

      return { copilotToken, userInfo };
    },
    mapTokens: (tokens, extra) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      name: extra?.userInfo?.login || extra?.userInfo?.name,
      displayName: extra?.userInfo?.name || extra?.userInfo?.login,
      email: extra?.userInfo?.email || null,
      providerSpecificData: {
        copilotToken: extra?.copilotToken?.token,
        copilotTokenExpiresAt: extra?.copilotToken?.expires_at,
        githubUserId: extra?.userInfo?.id,
        githubLogin: extra?.userInfo?.login,
        githubName: extra?.userInfo?.name,
        githubEmail: extra?.userInfo?.email,
      },
    }),
  },

  cursor: {
    config: CURSOR_CONFIG,
    flowType: "import_token",
    // Cursor uses import token flow - tokens are extracted from local SQLite database
    // No OAuth flow needed, handled by /api/oauth/cursor/import route
    mapTokens: (tokens) => ({
      accessToken: tokens.accessToken,
      refreshToken: null, // Cursor doesn't have public refresh endpoint
      expiresIn: tokens.expiresIn || 86400,
      providerSpecificData: {
        machineId: tokens.machineId,
        authMethod: "imported",
      },
    }),
  },

  "kimi-coding": {
    config: KIMI_CODING_CONFIG,
    flowType: "device_code",
    requestDeviceCode: async (config) => {
      const response = await fetch(config.deviceCodeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ client_id: config.clientId }),
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Device code request failed: ${error}`);
      }
      const data = await response.json();
      return {
        device_code: data.device_code,
        user_code: data.user_code,
        verification_uri: data.verification_uri || "https://www.kimi.com/code/authorize_device",
        verification_uri_complete:
          data.verification_uri_complete ||
          `https://www.kimi.com/code/authorize_device?user_code=${data.user_code}`,
        expires_in: data.expires_in,
        interval: data.interval || 5,
      };
    },
    pollToken: async (config, deviceCode) => {
      const response = await fetch(config.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          client_id: config.clientId,
          device_code: deviceCode,
        }),
      });
      let data;
      try {
        data = await response.json();
      } catch (e) {
        const text = await response.text();
        data = { error: "invalid_response", error_description: text };
      }
      return { ok: response.ok, data };
    },
    mapTokens: (tokens) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
    }),
  },

  kilocode: {
    config: KILOCODE_CONFIG,
    flowType: "device_code",
    requestDeviceCode: async (config) => {
      const response = await fetch(config.initiateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error("Too many pending authorization requests. Please try again later.");
        }
        const error = await response.text();
        throw new Error(`Device auth initiation failed: ${error}`);
      }
      const data = await response.json();
      return {
        device_code: data.code,
        user_code: data.code,
        verification_uri: data.verificationUrl,
        verification_uri_complete: data.verificationUrl,
        expires_in: data.expiresIn || 300,
        interval: 3,
      };
    },
    pollToken: async (config, deviceCode) => {
      const response = await fetch(`${config.pollUrlBase}/${deviceCode}`);
      if (response.status === 202) return { ok: false, data: { error: "authorization_pending" } };
      if (response.status === 403) return { ok: false, data: { error: "access_denied", error_description: "Authorization denied by user" } };
      if (response.status === 410) return { ok: false, data: { error: "expired_token", error_description: "Authorization code expired" } };
      if (!response.ok) return { ok: false, data: { error: "poll_failed", error_description: `Poll failed: ${response.status}` } };
      const data = await response.json();
      if (data.status === "approved" && data.token) {
        // Fetch profile to get orgId for X-Kilocode-OrganizationID header
        let orgId = null;
        try {
          const profileRes = await fetch(`${config.apiBaseUrl}/api/profile`, {
            headers: { "Authorization": `Bearer ${data.token}` }
          });
          if (profileRes.ok) {
            const profile = await profileRes.json();
            orgId = profile.organizations?.[0]?.id || null;
          }
        } catch {}
        return { ok: true, data: { access_token: data.token, _userEmail: data.userEmail, _orgId: orgId } };
      }
      return { ok: false, data: { error: "authorization_pending" } };
    },
    mapTokens: (tokens) => ({
      accessToken: tokens.access_token,
      refreshToken: null,
      expiresIn: null,
      email: tokens._userEmail,
      ...(tokens._orgId ? { providerSpecificData: { orgId: tokens._orgId } } : {}),
    }),
  },

};

/**
 * Get provider handler
 */
export function getProvider(name) {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown provider: ${name}`);
  }
  return provider;
}

/**
 * Get all provider names
 */
export function getProviderNames() {
  return Object.keys(PROVIDERS);
}

/**
 * Generate auth data for a provider
 * @param {object} [meta] - Provider-specific metadata (e.g. clientId/baseUrl)
 */
export async function generateAuthData(providerName, redirectUri, meta) {
  const provider = getProvider(providerName);
  const config = provider.prepareConfig
    ? await provider.prepareConfig(provider.config, meta || {})
    : provider.config;
  const { codeVerifier, codeChallenge, state } = generatePKCE(provider.pkceVerifierBytes);

  let authUrl;
  if (provider.flowType === "device_code") {
    // Device code flow doesn't have auth URL upfront
    authUrl = null;
  } else if (provider.flowType === "authorization_code_pkce") {
    authUrl = provider.buildAuthUrl(config, redirectUri, state, codeChallenge, meta || {});
  } else {
    authUrl = provider.buildAuthUrl(config, redirectUri, state, undefined, meta || {});
  }

  return {
    authUrl,
    state,
    codeVerifier,
    codeChallenge,
    redirectUri,
    flowType: provider.flowType,
    fixedPort: provider.fixedPort,
    callbackPath: provider.callbackPath || "/callback",
  };
}

/**
 * Exchange code for tokens
 * @param {object} [meta] - Provider-specific metadata (e.g. clientId/baseUrl)
 */
export async function exchangeTokens(providerName, code, redirectUri, codeVerifier, state, meta) {
  const provider = getProvider(providerName);
  const config = provider.prepareConfig
    ? await provider.prepareConfig(provider.config, meta || {})
    : provider.config;

  const tokens = await provider.exchangeToken(config, code, redirectUri, codeVerifier, state, meta || {});

  let extra = null;
  if (provider.postExchange) {
    extra = await provider.postExchange(tokens);
  }

  return provider.mapTokens(tokens, extra);
}

/**
 * Request device code (for device_code flow)
 */
export async function requestDeviceCode(providerName, codeChallenge, options) {
  const provider = getProvider(providerName);
  if (provider.flowType !== "device_code") {
    throw new Error(`Provider ${providerName} does not support device code flow`);
  }
  return await provider.requestDeviceCode(provider.config, codeChallenge, options || {});
}

/**
 * Poll for token (for device_code flow)
 * @param {string} providerName - Provider name
 * @param {string} deviceCode - Device code from requestDeviceCode
 * @param {string} codeVerifier - PKCE code verifier (optional for some providers)
 * @param {object} extraData - Provider-specific data captured during device authorization
 */
export async function pollForToken(providerName, deviceCode, codeVerifier, extraData) {
  const provider = getProvider(providerName);
  if (provider.flowType !== "device_code") {
    throw new Error(`Provider ${providerName} does not support device code flow`);
  }

  const result = await provider.pollToken(provider.config, deviceCode, codeVerifier, extraData);

  if (result.ok) {
    // For device code flows, success is only when we have an access token
    if (result.data.access_token) {
      // Call postExchange to get additional data (copilotToken, userInfo, etc.)
      let extra = null;
      if (provider.postExchange) {
        extra = await provider.postExchange(result.data);
      }
      const tokens = provider.mapTokens(result.data, extra);
      return { success: true, tokens };
    } else {
      // Check if it's still pending authorization
      if (result.data.error === 'authorization_pending' || result.data.error === 'slow_down') {
        // This is not a failure, just still waiting
        return {
          success: false,
          error: result.data.error,
          errorDescription: result.data.error_description || result.data.message,
          pending: result.data.error === 'authorization_pending'
        };
      } else {
        // Actual error
        return {
          success: false,
          error: result.data.error || 'no_access_token',
          errorDescription: result.data.error_description || result.data.message || 'No access token received'
        };
      }
    }
  }

  return { success: false, error: result.data.error, errorDescription: result.data.error_description };
}

// Run-once guard across the process lifetime
let codexBackfillDone = false;

// Backfill email + chatgpt account info for existing codex OAuth connections missing them
export async function backfillCodexEmails() {
  if (codexBackfillDone) return;
  codexBackfillDone = true;
  try {
    const { getProviderConnections, updateProviderConnection } = await import("@/lib/localDb");
    const connections = await getProviderConnections();
    const targets = connections.filter((c) => {
      if (c.provider !== "codex" || c.authType !== "oauth" || !c.idToken) return false;
      const hasEmail = !!c.email;
      const hasAccountInfo = !!c.providerSpecificData?.chatgptAccountId;
      return !hasEmail || !hasAccountInfo;
    });
    for (const conn of targets) {
      const info = extractCodexAccountInfo(conn.idToken);
      if (!info.email && !info.chatgptAccountId) continue;
      const patch = {};
      if (!conn.email && info.email) patch.email = info.email;
      if (info.chatgptAccountId || info.chatgptPlanType) {
        patch.providerSpecificData = {
          ...(conn.providerSpecificData || {}),
          chatgptAccountId: info.chatgptAccountId,
          chatgptPlanType: info.chatgptPlanType,
        };
      }
      if (Object.keys(patch).length) {
        await updateProviderConnection(conn.id, patch);
      }
    }
  } catch (err) {
    codexBackfillDone = false;
    console.log("backfillCodexEmails failed:", err?.message || err);
  }
}
