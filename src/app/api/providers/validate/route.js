import { NextResponse } from "next/server";
import { getProviderNodeById } from "@/models";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider, AI_PROVIDERS } from "@/shared/constants/providers";
import { getDefaultModel } from "open-sse/config/providerModels.js";
import { resolveXiaomiTokenplanBaseUrl, PROVIDERS } from "open-sse/config/providers.js";
import { openaiToCommandCodeRequest } from "open-sse/translator/request/openai-to-commandcode.js";
import { normalizeProviderId } from "@/lib/providerNormalization";
import { getVilaoModelsUrl } from "open-sse/providers/vilao.js";
import { resolveStepFunEndpoints } from "open-sse/providers/stepfun.js";
import { validateSafeBaseUrl } from "open-sse/utils/safeBaseUrl.js";

const VALIDATE_TIMEOUT_MS = 8000;
const VALIDATE_TIMEOUT_SLOW_MS = 10000;

// POST /api/providers/validate - Validate API key with provider
export async function POST(request) {
  try {
    const body = await request.json();
    const provider = normalizeProviderId(body.provider);
    const { apiKey, providerSpecificData } = body;

    const isNoAuth = AI_PROVIDERS[provider]?.noAuth === true;
    if (!provider || (!apiKey && !isNoAuth)) {
      return NextResponse.json({ error: "Provider and API key required" }, { status: 400 });
    }

    let isValid = false;
    let error = null;

    // Validate with each provider
    try {
      if (isOpenAICompatibleProvider(provider)) {
        const node = await getProviderNodeById(provider);
        if (!node) {
          return NextResponse.json({ error: "OpenAI Compatible node not found" }, { status: 404 });
        }
        // User-supplied base URLs are SSRF-guarded before they reach fetch().
        const check = validateSafeBaseUrl(node.baseUrl);
        if (!check.ok) {
          return NextResponse.json({ error: `Invalid base URL: ${check.error}` }, { status: 400 });
        }
        const modelsUrl = `${check.url.href.replace(/\/$/, "")}/models`;
        const res = await fetch(modelsUrl, {
          headers: { "Authorization": `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
        });
        isValid = res.ok;
        return NextResponse.json({
          valid: isValid,
          error: isValid ? null : "Invalid API key",
        });
      }

      if (isAnthropicCompatibleProvider(provider)) {
        const node = await getProviderNodeById(provider);
        if (!node) {
          return NextResponse.json({ error: "Anthropic Compatible node not found" }, { status: 404 });
        }

        const check = validateSafeBaseUrl(node.baseUrl);
        if (!check.ok) {
          return NextResponse.json({ error: `Invalid base URL: ${check.error}` }, { status: 400 });
        }
        let normalizedBase = check.url.href.replace(/\/$/, "");
        if (normalizedBase.endsWith("/messages")) {
          normalizedBase = normalizedBase.slice(0, -9); // remove /messages
        }

        const messagesUrl = `${normalizedBase}/v1/messages`;
        const model = node.defaultModel || "claude-3-haiku-20240307";

        const res = await fetch(messagesUrl, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            max_tokens: 1,
            messages: [{ role: "user", content: "test" }],
          }),
          signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
        });

        // 400/529 still confirms key accepted; only 401/403 = bad key
        isValid = res.status !== 401 && res.status !== 403;
        return NextResponse.json({
          valid: isValid,
          error: isValid ? null : "Invalid API key",
        });
      }

      switch (provider) {
        case "openai":
          const openaiRes = await fetch("https://api.openai.com/v1/models", {
            headers: { "Authorization": `Bearer ${apiKey}` },
          });
          isValid = openaiRes.ok;
          break;

        case "vilao":
          // Per-key gateway override (P2P marketplace) falls back to api.vilao.ai.
          const vilaoRes = await fetch(getVilaoModelsUrl(providerSpecificData?.baseUrl), {
            headers: { "Authorization": `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
          });
          // 402 = authenticated but out of balance → the key itself is valid.
          isValid = vilaoRes.ok || vilaoRes.status === 402;
          break;

        case "anthropic":
          const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: "claude-3-haiku-20240307",
              max_tokens: 1,
              messages: [{ role: "user", content: "test" }],
            }),
            signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
          });
          isValid = anthropicRes.status !== 401;
          break;

        case "openrouter":
          const openrouterRes = await fetch("https://openrouter.ai/api/v1/models", {
            headers: { "Authorization": `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
          });
          isValid = openrouterRes.ok;
          break;

        case "glm":
        case "kimi":
        case "minimax":
        case "agentrouter": {
          // Use baseUrl from PROVIDERS (DRY) for Anthropic-compatible providers.
          const cfg = PROVIDERS[provider];
          const testModel = getDefaultModel(provider) || "claude-sonnet-4-20250514";
          const res = await fetch(cfg.baseUrl, {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
              ...(cfg.headers || {}),
            },
            body: JSON.stringify({ model: testModel, max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
            signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
          });
          // 400 = model resolution error but auth passed (e.g. agentrouter "no available channel")
          isValid = res.status !== 401 && res.status !== 403;
          break;
        }
        case "deepseek":
        case "groq":
        case "xai":
        case "mistral":
        case "stepfun":
        case "ollama":
        case "xiaomi-mimo":
        case "xiaomi-tokenplan": {
          const endpoints = {
            ...Object.fromEntries(
              Object.entries(PROVIDERS).filter(([, t]) => t.validateUrl).map(([id, t]) => [id, t.validateUrl])
            ),
            // dynamic URLs (depend on providerSpecificData) — kept inline
            "xiaomi-tokenplan": `${resolveXiaomiTokenplanBaseUrl({ providerSpecificData })}/models`,
            stepfun: resolveStepFunEndpoints(providerSpecificData).models,
          };
          const headers = {};
          if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
          const res = await fetch(endpoints[provider], { headers, signal: AbortSignal.timeout(8000) });
          // xai returns 400 for bad key, 403 for valid-but-no-credit. Other providers use 401.
          if (provider === "stepfun") {
            isValid = res.ok;
          } else if (provider === "xai") {
            isValid = res.status === 200 || res.status === 403;
          } else if (provider === "xiaomi-tokenplan") {
            // /models returns 403 for valid keys lacking list permission; only 401 means invalid
            isValid = res.status !== 401;
          } else {
            isValid = res.ok;
          }
          break;
        }

        case "opencode-go": {
          const res = await fetch("https://opencode.ai/zen/go/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: getDefaultModel("opencode-go"),
              messages: [{ role: "user", content: "ping" }],
              max_tokens: 1,
              stream: false,
            }),
            signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
          });
          isValid = res.status !== 401 && res.status !== 403;
          break;
        }

        case "commandcode": {
          const cfg = PROVIDERS.commandcode;
          const model = getDefaultModel("commandcode");
          const payload = openaiToCommandCodeRequest(model, {
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
            stream: false,
          }, false);
          const res = await fetch(cfg.baseUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(cfg.headers || {}),
              "x-session-id": crypto.randomUUID(),
              "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
          });
          isValid = res.status !== 401 && res.status !== 403;
          break;
        }

        case "grok-web": {
          const token = apiKey.startsWith("sso=") ? apiKey.slice(4) : apiKey;
          // Cloudflare-bypass: send POST with same browser fingerprint headers as GrokWebExecutor
          const randomHex = (n) => {
            const a = new Uint8Array(n);
            crypto.getRandomValues(a);
            return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
          };
          const statsigId = Buffer.from("e:TypeError: Cannot read properties of null (reading 'children')").toString("base64");
          const traceId = randomHex(16);
          const spanId = randomHex(8);
          const res = await fetch("https://grok.com/rest/app-chat/conversations/new", {
            method: "POST",
            headers: {
              Accept: "*/*",
              "Accept-Encoding": "gzip, deflate, br, zstd",
              "Accept-Language": "en-US,en;q=0.9",
              "Cache-Control": "no-cache",
              "Content-Type": "application/json",
              Cookie: `sso=${token}`,
              Origin: "https://grok.com",
              Pragma: "no-cache",
              Referer: "https://grok.com/",
              "Sec-Ch-Ua": '"Google Chrome";v="136", "Chromium";v="136", "Not(A:Brand";v="24"',
              "Sec-Ch-Ua-Mobile": "?0",
              "Sec-Ch-Ua-Platform": '"macOS"',
              "Sec-Fetch-Dest": "empty",
              "Sec-Fetch-Mode": "cors",
              "Sec-Fetch-Site": "same-origin",
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
              "x-statsig-id": statsigId,
              "x-xai-request-id": crypto.randomUUID(),
              traceparent: `00-${traceId}-${spanId}-00`,
            },
            body: JSON.stringify({
              temporary: true, modelName: "grok-4", modelMode: "MODEL_MODE_GROK_4", message: "ping",
              fileAttachments: [], imageAttachments: [],
              disableSearch: false, enableImageGeneration: false, returnImageBytes: false,
              returnRawGrokInXaiRequest: false, enableImageStreaming: false, imageGenerationCount: 0,
              forceConcise: false, toolOverrides: {}, enableSideBySide: true, sendFinalMetadata: true,
              isReasoning: false, disableTextFollowUps: true, disableMemory: true,
              forceSideBySide: false, isAsyncChat: false, disableSelfHarmShortCircuit: false,
            }),
            signal: AbortSignal.timeout(VALIDATE_TIMEOUT_SLOW_MS),
          });
          // Cookie valid = any non-401/403 response (200, 400, 429 all mean cookie accepted)
          if (res.status === 401 || res.status === 403) {
            isValid = false;
            error = "Invalid SSO cookie — re-paste from grok.com DevTools → Cookies → sso";
          } else {
            isValid = true;
          }
          break;
        }



        default: {
          // Generic probe for OpenAI-compatible providers (config-driven from PROVIDERS)
          const cfg = PROVIDERS[provider];
          if (!cfg || cfg.format !== "openai" || !cfg.baseUrl) {
            return NextResponse.json({ error: "Provider validation not supported" }, { status: 400 });
          }
          if (cfg.noAuth) {
            isValid = true;
            break;
          }
          // Build auth headers based on cfg.authHeader (default: bearer)
          const headers = { "Content-Type": "application/json", ...(cfg.headers || {}) };
          if (cfg.authHeader === "x-api-key") headers["X-API-Key"] = apiKey;
          else headers["Authorization"] = `Bearer ${apiKey}`;
          // Try /models first (fast GET), fallback to chat probe on ambiguous response
          const modelsUrl = cfg.baseUrl.replace(/\/chat\/completions$/, "/models").replace(/\/chatbot$/, "/models");
          let probeOk = null;
          try {
            const probeRes = await fetch(modelsUrl, { headers, signal: AbortSignal.timeout(8000) });
            if (probeRes.status === 401 || probeRes.status === 403) probeOk = false;
            else if (probeRes.ok) probeOk = true;
          } catch { /* fallback to chat */ }
          if (probeOk !== null) {
            isValid = probeOk;
            break;
          }
          // Fallback: minimal chat probe
          const defaultModel = getDefaultModel(provider) || "test";
          const chatRes = await fetch(cfg.baseUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({ model: defaultModel, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
            signal: AbortSignal.timeout(10000),
          });
          isValid = chatRes.status !== 401 && chatRes.status !== 403;
          break;
        }
      }
    } catch (err) {
      error = err.message;
      isValid = false;
    }

    return NextResponse.json({
      valid: isValid,
      error: isValid ? null : (error || "Invalid API key"),
    });
  } catch (error) {
    console.error("Error validating API key:", error);
    return NextResponse.json({ error: "Validation failed" }, { status: 500 });
  }
}
