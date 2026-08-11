"use server";

import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/db/index.js";

const AIZEN_SETTINGS_KEY = "aizenConfig";

// GET — read aizen settings from DB
export async function GET() {
  try {
    const settings = await getSettings();
    const aizenConfig = settings[AIZEN_SETTINGS_KEY] || {};

    return NextResponse.json({
      installed: true,
      hasSwitchRouter: !!(aizenConfig.baseUrl && aizenConfig.apiKey),
      settings: aizenConfig,
    });
  } catch (error) {
    console.log("Error checking aizen settings:", error);
    return NextResponse.json(
      { error: "Failed to check aizen settings" },
      { status: 500 }
    );
  }
}

// POST — save aizen config (full replace)
export async function POST(request) {
  try {
    const body = await request.json();
    const { baseUrl, apiKey, models, activeModel, subagentModel, thinkingEffort, autoCompact, mcpCodebaseMemory } = body;

    if (baseUrl && typeof baseUrl !== "string") {
      return NextResponse.json({ error: "Invalid baseUrl" }, { status: 400 });
    }

    const aizenConfig = {};
    if (baseUrl) aizenConfig.baseUrl = baseUrl;
    if (apiKey) aizenConfig.apiKey = apiKey;
    if (Array.isArray(models) && models.length > 0) aizenConfig.models = models;
    if (activeModel) aizenConfig.activeModel = activeModel;
    if (subagentModel !== undefined) aizenConfig.subagentModel = subagentModel;
    if (thinkingEffort !== undefined) aizenConfig.thinkingEffort = thinkingEffort;
    if (autoCompact !== undefined) aizenConfig.autoCompact = autoCompact;
    if (mcpCodebaseMemory !== undefined) aizenConfig.mcpCodebaseMemory = mcpCodebaseMemory;

    await updateSettings({ [AIZEN_SETTINGS_KEY]: aizenConfig });

    return NextResponse.json({
      success: true,
      message: "Aizen settings saved successfully",
    });
  } catch (error) {
    console.log("Error updating aizen settings:", error);
    return NextResponse.json(
      { error: "Failed to update aizen settings" },
      { status: 500 }
    );
  }
}

// PATCH — update a single field (fast toggle)
export async function PATCH(request) {
  try {
    const body = await request.json();
    const settings = await getSettings();
    const aizenConfig = { ...(settings[AIZEN_SETTINGS_KEY] || {}) };

    // Accept any scalar field for fast toggle
    for (const [key, value] of Object.entries(body)) {
      if (["baseUrl", "apiKey", "activeModel", "subagentModel", "thinkingEffort", "autoCompact", "mcpCodebaseMemory"].includes(key)) {
        aizenConfig[key] = value;
      }
    }

    await updateSettings({ [AIZEN_SETTINGS_KEY]: aizenConfig });

    return NextResponse.json({
      success: true,
      message: "Setting updated",
    });
  } catch (error) {
    console.log("Error patching aizen settings:", error);
    return NextResponse.json(
      { error: "Failed to update setting" },
      { status: 500 }
    );
  }
}

// DELETE — reset all or remove a specific model
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const modelToRemove = searchParams.get("model");

    if (modelToRemove) {
      // Remove a single model from the list
      const settings = await getSettings();
      const aizenConfig = { ...(settings[AIZEN_SETTINGS_KEY] || {}) };
      const models = Array.isArray(aizenConfig.models) ? aizenConfig.models.filter((m) => m !== modelToRemove) : [];

      aizenConfig.models = models;

      // If removed model was active, clear or switch
      if (aizenConfig.activeModel === modelToRemove) {
        aizenConfig.activeModel = models.length > 0 ? models[0] : "";
      }
      // If removed model was subagent, clear
      if (aizenConfig.subagentModel === modelToRemove) {
        aizenConfig.subagentModel = "";
      }

      await updateSettings({ [AIZEN_SETTINGS_KEY]: aizenConfig });

      return NextResponse.json({
        success: true,
        message: `Model "${modelToRemove}" removed`,
      });
    }

    // Full reset
    await updateSettings({ [AIZEN_SETTINGS_KEY]: {} });

    return NextResponse.json({
      success: true,
      message: "Aizen settings reset successfully",
    });
  } catch (error) {
    console.log("Error resetting aizen settings:", error);
    return NextResponse.json(
      { error: "Failed to reset aizen settings" },
      { status: 500 }
    );
  }
}