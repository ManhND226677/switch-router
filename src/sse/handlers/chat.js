import "open-sse/index.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { isModelLockActive } from "open-sse/services/accountFallback.js";
import { getProviderConnections } from "@/lib/localDb";
import { cacheClaudeHeaders } from "open-sse/utils/claudeHeaderCache.js";
import { getSettings } from "@/lib/localDb";
import { getApiKeyByKey, getKeyMonthlySpendUsd, updateApiKey } from "@/lib/localDb";
import { checkKeyPolicy, checkBudget } from "../services/keyPolicy.js";
import { consumeRateLimit } from "../services/keyRateLimiter.js";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { getTransform as getPxpipeTransform } from "@/lib/pxpipe/loader.js";
import { appendPxpipeEvent } from "@/lib/pxpipe/events.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { handleComboChat, handleFusionChat } from "open-sse/services/combo.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { RoutingEngine } from "@/core/routing/routingEngine.js";
import { modelForProvider, resolveConnectionSelector } from "../services/connectionSelector.js";
import {
  appendOfficePowerPointRuntimeGuardrail,
  getOfficeRequestPolicy,
  routeOfficeRequestModel,
} from "../services/officeRequestPolicy.js";

/**
 * Handle chat completion request
 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats
 * Format detection and translation handled by translator
 */
export async function handleChat(request, clientRawRequest = null) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  // Build clientRawRequest for logging (if not provided)
  if (!clientRawRequest) {
    const url = new URL(request.url);
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: Object.fromEntries(request.headers.entries())
    };
  }
  // Preserve clientRawRequest as the exact Office payload for logging/session
  // semantics; the gateway-owned guardrail is added only to the working body.
  const routedOfficeBody = routeOfficeRequestModel(body, clientRawRequest?.endpoint);
  if (routedOfficeBody !== body) {
    log.info("OFFICE", `Model route ${body.model || "unknown"} -> ${routedOfficeBody.model}`);
  }
  body = routedOfficeBody;
  body = appendOfficePowerPointRuntimeGuardrail(body, clientRawRequest?.endpoint);
  cacheClaudeHeaders(clientRawRequest.headers);

  const modelStr = body.model;
  const { preferredConnectionId, providerHint } = resolveConnectionSelector(request, body);
  const routedModelStr = modelForProvider(modelStr, providerHint);

  // Request summary is emitted as the unified "▶" line in chatCore (has fmt/thinking/account)

  // Log API key (masked)
  const authHeader = request.headers.get("Authorization");
  const apiKey = extractApiKey(request);
  if (authHeader && apiKey) {
    const masked = log.maskKey(apiKey);
    log.debug("AUTH", `API Key: ${masked}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Enforce API key if enabled in settings
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    const valid = await isValidApiKey(apiKey);
    if (!valid) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  // Virtual key policy (migration 004) — chỉ áp dụng khi bật khoá và client
  // đưa key hợp lệ. Allowlist so theo id client yêu cầu (model/combo public).
  if (settings.requireApiKey && apiKey) {
    try {
      const virtualKeyRecord = await getApiKeyByKey(apiKey);
      if (virtualKeyRecord?.isActive) {
        const policyResult = checkKeyPolicy(virtualKeyRecord, modelStr);
        if (!policyResult.ok) {
          if (policyResult.code === "expired") {
            log.warn("AUTH", `Virtual key expired: ${virtualKeyRecord.name || virtualKeyRecord.id}`);
            return errorResponse(HTTP_STATUS.FORBIDDEN, "Khóa đã hết hạn");
          }
          log.warn("AUTH", `Model not allowed for key "${virtualKeyRecord.name}": ${modelStr}`);
          return errorResponse(HTTP_STATUS.FORBIDDEN, `Model không được phép cho khóa này: ${modelStr}`);
        }
        if (virtualKeyRecord.monthlyBudgetUsd != null) {
          const spentUsd = await getKeyMonthlySpendUsd(virtualKeyRecord);
          const budget = checkBudget(virtualKeyRecord.monthlyBudgetUsd, spentUsd);
          if (!budget.ok) {
            log.warn("AUTH", `Monthly budget exceeded for key "${virtualKeyRecord.name}" (${spentUsd.toFixed(4)}/${virtualKeyRecord.monthlyBudgetUsd} USD)`);
            return errorResponse(HTTP_STATUS.PAYMENT_REQUIRED, "Vượt ngân sách tháng của khóa này");
          }
        }
        const rateLimitCheck = consumeRateLimit(virtualKeyRecord.id, virtualKeyRecord.rateLimitRpm);
        if (rateLimitCheck.limited) {
          log.warn("AUTH", `RPM limited key "${virtualKeyRecord.name}", retry after ${rateLimitCheck.retryAfterSec}s`);
          return errorResponse(HTTP_STATUS.RATE_LIMITED, `Quá giới hạn ${virtualKeyRecord.rateLimitRpm} request/phút, thử lại sau ${rateLimitCheck.retryAfterSec}s`);
        }
        // Ghi lastUsedAt tối đa 1 lần/phút/key — tránh ghi DB mỗi request
        const lastUsedMs = Date.parse(virtualKeyRecord.lastUsedAt || "");
        if (!Number.isFinite(lastUsedMs) || Date.now() - lastUsedMs > 60_000) {
          updateApiKey(virtualKeyRecord.id, { lastUsedAt: new Date().toISOString() }).catch(() => {});
        }
      }
    } catch (policyError) {
      // Lỗi hạ tầng đọc policy → fail-open như trước khi có tính năng, không chặn chat
      log.warn("AUTH", `Virtual key policy skipped: ${policyError?.message}`);
    }
  }

  // Bypass naming/warmup requests before combo rotation to avoid wasting rotation slots
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, routedModelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  // Check if model is a combo (has multiple models with fallback)
  const comboModels = await getComboModels(routedModelStr);
  if (comboModels) {
    // Check for combo-specific strategy first, fallback to global
    const comboStrategies = settings.comboStrategies || {};
    const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
    const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";

    if (comboStrategy === "fusion") {
      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
      return handleFusionChat({
        body,
        models: comboModels,
        handleSingleModel: (b, m, isPanel) => {
          let cleanRawReq = clientRawRequest;
          if (isPanel && clientRawRequest) {
            const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
            cleanRawReq = { ...clientRawRequest, body: cleanBody };
          }
          return handleSingleModelChat(b, m, cleanRawReq, request, apiKey, preferredConnectionId, settings);
        },
        log,
        comboName: modelStr,
        judgeModel: comboStrategies[modelStr]?.judgeModel,
        tuning: comboStrategies[modelStr]?.fusionTuning,
      });
    }

    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey, preferredConnectionId, settings),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit
    });
  }

  // Single model request — reuse the settings already loaded above
  return handleSingleModelChat(body, routedModelStr, clientRawRequest, request, apiKey, preferredConnectionId, settings);
}

/**
 * Handle single model chat request
 * @param {object|null} settingsHint - optional preloaded settings to avoid a second getSettings() on hot path
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null, preferredConnectionId = null, settingsHint = null) {
  const modelInfo = await getModelInfo(modelStr);

  if (modelInfo.provider) {
    return handleSingleModelRequest(body, modelStr, clientRawRequest, request, apiKey, modelInfo, preferredConnectionId, settingsHint);
  }

  // If provider is null, this might be a combo name - check and handle
  if (!modelInfo.provider) {
    const comboModels = await getComboModels(modelStr);
    if (comboModels) {
      const chatSettings = settingsHint || await getSettings();
      // Check for combo-specific strategy first, fallback to global
      const comboStrategies = chatSettings.comboStrategies || {};
      const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
      const comboStrategy = comboSpecificStrategy || chatSettings.comboStrategy || "fallback";

      if (comboStrategy === "fusion") {
        log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
        return handleFusionChat({
          body,
          models: comboModels,
          handleSingleModel: (b, m, isPanel) => {
            let cleanRawReq = clientRawRequest;
            if (isPanel && clientRawRequest) {
              const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
              cleanRawReq = { ...clientRawRequest, body: cleanBody };
            }
            return handleSingleModelChat(b, m, cleanRawReq, request, apiKey, preferredConnectionId, chatSettings);
          },
          log,
          comboName: modelStr,
          judgeModel: comboStrategies[modelStr]?.judgeModel,
          tuning: comboStrategies[modelStr]?.fusionTuning,
        });
      }

      const comboStickyLimit = chatSettings.comboStickyRoundRobinLimit;
      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
      return handleComboChat({
        body,
        models: comboModels,
        handleSingleModel: (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey, preferredConnectionId, chatSettings),
        log,
        comboName: modelStr,
        comboStrategy,
        comboStickyLimit
      });
    }
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }
}

async function handleSingleModelRequest(body, modelStr, clientRawRequest = null, request = null, apiKey = null, modelInfo = null, preferredConnectionId = null, settingsHint = null) {
  const resolvedModelInfo = modelInfo || await getModelInfo(modelStr);
  const { provider, model } = resolvedModelInfo;

  // Extract userAgent from request
  const userAgent = request?.headers?.get("user-agent") || "";
  // Dashboard "Test model" probes set x-9r-probe=1 so we:
  //  - try only ONE account (no multi-account cascade)
  //  - do NOT write modelLock_* / testStatus=unavailable on failure
  // Otherwise a single Test click burns every Antigravity account on 429.
  const isProbe = request?.headers?.get("x-9r-probe") === "1";

  // Hoist per-request constants outside the account-fallback loop so multi-account
  // retries do not re-parse URL, re-read settings, or re-warm pxpipe.
  const chatSettings = settingsHint || await getSettings();
  const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
  const requestPolicy = getOfficeRequestPolicy(chatSettings, clientRawRequest?.endpoint);
  const sourceFormatOverride = request?.url
    ? detectFormatByEndpoint(new URL(request.url).pathname, body)
    : null;
  const pxpipeTransform = requestPolicy.pxpipeEnabled ? await getPxpipeTransform() : null;
  const coreBodyBase = { ...body, model: `${provider}/${model}`, ...(isProbe ? { __probe: true } : {}) };

  // Candidate accounts for this provider/model (approximation over the cached
  // connection list). While more candidates remain beyond the current one, the
  // executor skips 5xx backoff retries and lets the engine switch accounts
  // immediately instead of burning ~9s of same-account retries per failure.
  let candidateAccountCount = 1;
  try {
    const providerConnections = await getProviderConnections({ provider });
    candidateAccountCount = providerConnections.filter(
      (c) => c.isActive !== false && !isModelLockActive(c, model)
    ).length;
  } catch { /* keep single-account (full retry) semantics on read failure */ }

  const accountFallbackEngine = new RoutingEngine({
    maxAttempts: isProbe ? 1 : 64,
    resolveCredentials: ({ excludedConnectionIds }) => getProviderCredentials(
      provider,
      excludedConnectionIds,
      model,
      { preferredConnectionId },
    ),
    executeAttempt: async ({ credentials, excludedConnectionIds }) => {
    const hasFallbackAccount = candidateAccountCount > (excludedConnectionIds.size + 1);
    // Account selection shown in the unified "▶" line (acc:...)
    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    // Ensure real project ID is available for providers that need it (P0 fix: cold miss).
    // Antigravity MUST have a real cloudaicompanion project — random ids cause 429.
    if ((provider === "antigravity" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
      const pid = await getProjectIdForConnection(credentials.connectionId, refreshedCredentials.accessToken);
      if (pid) {
        refreshedCredentials.projectId = pid;
        // Persist so subsequent requests skip the round-trip
        try {
          await updateProviderCredentials(credentials.connectionId, { projectId: pid });
        } catch {
          updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => { });
        }
      } else if (provider === "antigravity") {
        return {
          success: false,
          status: 424,
          error: `[antigravity/${model}] Cloud Code projectId missing for this account. Open Antigravity IDE once with the same Google account, or remove & re-add the connection so onboardUser can bind a project.`,
          response: null,
        };
      }
    }

    if (isProbe) {
      // Propagate probe flag into executor (disables per-status retry loops).
      refreshedCredentials.isProbe = true;
      refreshedCredentials.providerSpecificData = {
        ...(refreshedCredentials.providerSpecificData || {}),
        isProbe: true,
      };
    }
    const result = await handleChatCore({
      body: coreBodyBase,
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      clientRawRequest,
      connectionId: credentials.connectionId,
      userAgent,
      apiKey,
      ccFilterNaming: !!chatSettings.ccFilterNaming,
      fastFail5xx: hasFallbackAccount,
      rtkEnabled: requestPolicy.rtkEnabled,
      cavemanEnabled: requestPolicy.cavemanEnabled,
      cavemanLevel: chatSettings.cavemanLevel || "full",
      ponytailEnabled: requestPolicy.ponytailEnabled,
      ponytailLevel: chatSettings.ponytailLevel || "full",
      pxpipeEnabled: requestPolicy.pxpipeEnabled,
      pxpipeMinChars: chatSettings.pxpipeMinChars,
      pxpipeTimeoutMs: chatSettings.pxpipeTimeoutMs,
      // Lazily warms the in-process module on first use; null when not installed (fail-open)
      pxpipeTransform,
      onPxpipeEvent: appendPxpipeEvent,
      providerThinking,
      preserveClientPayload: requestPolicy.preserveClientPayload,
      sourceFormatOverride,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          ...newCreds,
          existingProviderSpecificData: credentials.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
      }
    });

      return result;
    },
    onFailure: async ({ credentials, result }) => {
      if (isProbe) {
        // Probe path: report failure to the tester without locking the account/model.
        log.warn("PROBE", `test-only failure ${provider}/${model} acc:${credentials.connectionName} status=${result.status} (no lock)`);
        return { shouldFallback: false };
      }

      // Mark account unavailable (auto-calculates cooldown with exponential backoff, or precise resetsAtMs)
      const { shouldFallback } = await markAccountUnavailable(
        credentials.connectionId,
        result.status,
        result.error,
        provider,
        model,
        result.resetsAtMs,
      );

      if (shouldFallback) {
        log.warn("FALLBACK", `⇄ ACC:${credentials.connectionName} UNAVAILABLE (${result.status}) → NEXT ACCOUNT`);
      }

      return { shouldFallback };
    },
  });

  const executionResult = await accountFallbackEngine.execute({
    provider,
    model,
    context: { body, clientRawRequest, request, apiKey, userAgent },
  });

  if (executionResult.outcome === "unavailable") {
    const { credentials, lastResult, excludedConnectionIds } = executionResult;
    if (credentials?.allRateLimited) {
      const errorMsg = lastResult?.error || credentials.lastError || "Unavailable";
      const status = lastResult?.status || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
      log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
      return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
    }
    if (excludedConnectionIds.size === 0) {
      log.warn("AUTH", `No active credentials for provider: ${provider}`);
      return errorResponse(HTTP_STATUS.NOT_FOUND, `No active credentials for provider: ${provider}`);
    }
    log.warn("CHAT", "No more accounts available", { provider });
    return errorResponse(lastResult?.status || HTTP_STATUS.SERVICE_UNAVAILABLE, lastResult?.error || "All accounts unavailable");
  }

  return executionResult.response;
}
