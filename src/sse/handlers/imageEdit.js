import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { handleImageEditCore } from "open-sse/handlers/imageGenerationCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { checkAndRefreshToken } from "../services/tokenRefresh.js";
import { resolveConnectionSelector } from "../services/connectionSelector.js";
import * as log from "../utils/logger.js";

export async function handleImageEdit(request) {
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid multipart form data");
  }

  const settings = await getSettings();
  const apiKey = extractApiKey(request);
  if (settings.requireApiKey) {
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    if (!(await isValidApiKey(apiKey))) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  const selector = resolveConnectionSelector(request, { provider: formData.get("provider") });
  const rawModel = String(formData.get("model") || "step-image-edit-2");
  const modelStr = rawModel.includes("/") ? rawModel : `${selector.providerHint || "stepfun"}/${rawModel}`;
  const [provider, ...modelParts] = modelStr.split("/");
  const model = modelParts.join("/");
  if (!provider || !model) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");

  const binaryOutput = new URL(request.url).searchParams.get("response_format") === "binary";
  const excluded = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excluded, model, {
      preferredConnectionId: selector.preferredConnectionId,
    });
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const message = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        return unavailableResponse(status, `[${provider}/${model}] ${message}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excluded.size === 0) return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    const refreshed = await checkAndRefreshToken(provider, credentials);
    const result = await handleImageEditCore({
      formData,
      modelInfo: { provider, model },
      credentials: refreshed,
      binaryOutput,
      log,
      onRequestSuccess: () => clearAccountError(credentials.connectionId, credentials, model),
    });
    if (result.success) return result.response;

    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model);
    if (shouldFallback) {
      excluded.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }
    return result.response || errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "Image edit failed");
  }
}
