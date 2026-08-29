import { NextResponse } from "next/server";
import { getProviderConnectionById, getCustomModels, getModelAliases } from "@/lib/localDb";
import { getProviderModels, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { SERVER_CONFIG } from "@/shared/constants/config";
import { pingModelByKind } from "@/app/api/models/test/ping";
import { PROVIDERS } from "open-sse/config/providers.js";

/**
 * POST /api/providers/[id]/test-models
 * id = connectionId — used only to resolve provider + model list.
 * Actual requests go through the internal endpoint that matches each model kind.
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const providerId = connection.provider;
    const isCompatible = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);
    const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
    const passthrough = PROVIDERS[providerId]?.passthroughModels === true;

    let models = getProviderModels(alias);

    const baseUrl = `http://127.0.0.1:${process.env.PORT || SERVER_CONFIG.appPort}`;

    // Compatible providers / passthrough catalogs (e.g. vilao): prefer live or local custom list.
    if ((isCompatible || passthrough) && models.length === 0) {
      // 1) Custom models + aliases already imported into the dashboard
      try {
        const [custom, aliases] = await Promise.all([
          getCustomModels().catch(() => []),
          getModelAliases().catch(() => ({})),
        ]);
        const fromCustom = (custom || [])
          .filter((m) => m.providerAlias === alias || m.providerAlias === providerId)
          .map((m) => ({ id: m.id, name: m.name || m.id, kind: m.kind || m.type || "llm" }));
        const fromAliases = Object.entries(aliases || {})
          .filter(([, full]) => typeof full === "string" && (full.startsWith(`${alias}/`) || full.startsWith(`${providerId}/`)))
          .map(([, full]) => {
            const modelId = full.split("/").slice(1).join("/");
            return { id: modelId, name: modelId, kind: "llm" };
          });
        const seen = new Set();
        models = [...fromCustom, ...fromAliases].filter((m) => {
          if (!m.id || seen.has(m.id)) return false;
          seen.add(m.id);
          return true;
        });
      } catch { /* ignore */ }

      // 2) Live /models when still empty
      if (models.length === 0) {
        try {
          const modelsRes = await fetch(`${baseUrl}/api/providers/${id}/models`);
          if (modelsRes.ok) {
            const data = await modelsRes.json();
            models = (data.models || []).map((m) => ({ id: m.id || m.name, name: m.name || m.id }));
          }
        } catch { /* fallback to empty */ }
      }
    }

    if (models.length === 0) {
      return NextResponse.json({ error: "No models configured for this provider" }, { status: 400 });
    }

    // Warm up with first model to trigger token refresh (if needed) before parallel calls.
    // This prevents race condition where multiple requests concurrently refresh the same token.
    const [first, ...rest] = models;
    const firstKind = first.kind || first.type || "llm";
    const firstResult = await pingModelByKind(`${alias}/${first.id}`, firstKind, baseUrl);
    const results = [{ modelId: first.id, name: first.name || first.id, ...firstResult }];

    if (rest.length > 0) {
      const restResults = await Promise.all(
        rest.map(async (model) => {
          const result = await pingModelByKind(`${alias}/${model.id}`, model.kind || model.type || "llm", baseUrl);
          return { modelId: model.id, name: model.name || model.id, ...result };
        })
      );
      results.push(...restResults);
    }

    return NextResponse.json({ provider: providerId, connectionId: id, results });
  } catch (error) {
    console.error("Error testing models:", error);
    return NextResponse.json({ error: "Test failed" }, { status: 500 });
  }
}
