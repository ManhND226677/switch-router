import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";
import { AI_PROVIDERS, ALIAS_TO_ID } from "@/shared/constants/providers";
import { getModelKind } from "@/shared/constants/models";

const KIND_ENDPOINT = {
  llm: "/v1/chat/completions",
  imageToText: "/v1/chat/completions",
};

function buildInfo({ alias, providerId, model, kind, providerInfo }) {
  const out = {
    id: `${alias}/${model.id}`,
    name: model.name || model.id,
    kind,
    owned_by: alias,
    endpoint: KIND_ENDPOINT[kind] || null,
  };
  if (model.params) out.params = model.params;
  if (model.capabilities) out.capabilities = model.capabilities;
  if (model.options) out.options = model.options;
  if (model.dimensions) out.dimensions = model.dimensions;
  if (model.contextWindow) out.contextWindow = model.contextWindow;
  return out;
}

// id format: "{alias}/{modelId}" - alias may also be providerId
// requestedKind: optional, disambiguates duplicate ids across kinds (e.g. gemini-2.5-pro llm vs stt)
function lookup(fullId, requestedKind) {
  if (!fullId || !fullId.includes("/")) return null;
  const slash = fullId.indexOf("/");
  const alias = fullId.slice(0, slash);
  const modelId = fullId.slice(slash + 1);
  const providerId = ALIAS_TO_ID[alias] || alias;
  const providerInfo = AI_PROVIDERS[providerId];

  // PROVIDER_MODELS lookup (by alias key, fallback to providerId)
  const list = PROVIDER_MODELS[alias] || PROVIDER_MODELS[providerId] || [];
  const m = requestedKind
    ? list.find((x) => x.id === modelId && getModelKind(x, "llm") === requestedKind)
    : list.find((x) => x.id === modelId);
  if (m) {
    const kind = getModelKind(m, "llm");
    return buildInfo({ alias, providerId, model: m, kind, providerInfo });
  }
  return null;
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" },
  });
}

// GET /v1/models/info?id={alias}/{modelId} — metadata for a single model
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const kind = searchParams.get("kind");
  if (!id) {
    return Response.json(
      { error: { message: "Missing required query param: id (e.g. ?id=openai/gpt-5)", type: "invalid_request_error" } },
      { status: 400, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
  const info = lookup(id, kind);
  if (!info) {
    return Response.json(
      { error: { message: `Model not found: ${id}`, type: "not_found" } },
      { status: 404, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
  return Response.json(info, { headers: { "Access-Control-Allow-Origin": "*" } });
}
