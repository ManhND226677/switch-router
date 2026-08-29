import { buildModelsList } from "@/app/api/v1/models/route.js";
import {
  officeErrorResponse,
  officeJsonResponse,
  officeOptionsResponse,
  requireOfficeGatewayAccess,
  selectOfficeModelIds,
} from "../_shared.js";

function displayNameForModel(model) {
  if (typeof model?.name === "string" && model.name.trim()) return model.name.trim();
  return String(model?.id || "");
}

function toAnthropicModel(model) {
  const result = {
    id: model.id,
    type: "model",
    object: "model",
    display_name: displayNameForModel(model),
    owned_by: model.owned_by,
  };

  for (const key of ["created_at", "max_input_tokens", "max_tokens", "capabilities"]) {
    if (model[key] !== undefined && model[key] !== null) result[key] = model[key];
  }

  return result;
}

export async function OPTIONS(request) {
  return officeOptionsResponse(request);
}

/**
 * GET /office/v1/models - Anthropic-compatible model catalog for Claude for M365.
 */
export async function GET(request) {
  const accessError = await requireOfficeGatewayAccess(request);
  if (accessError) return accessError;

  try {
    const models = await buildModelsList(["llm"], {
      skipDynamicFetch: request.headers.get("x-switch-router-internal-models-fetch") === "1"
        || request.headers.get("x-9r-internal-models-fetch") === "1",
    });
    const selected = selectOfficeModelIds(models).map(toAnthropicModel);

    return officeJsonResponse({
      object: "list",
      data: selected,
      first_id: selected[0]?.id || null,
      last_id: selected[selected.length - 1]?.id || null,
      has_more: false,
    }, request);
  } catch (error) {
    console.error("Error fetching Office gateway models:", error);
    return officeErrorResponse(500, error.message || "Failed to fetch models", request, "server_error");
  }
}

export const __test__ = {
  displayNameForModel,
  toAnthropicModel,
};
