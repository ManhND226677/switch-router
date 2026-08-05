"use server";

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getRuntimeHomeDir } from "@/lib/runtimePaths";
import {
  SWITCH_ROUTER_PROVIDER,
  LEGACY_SWITCH_ROUTER_PROVIDER,
  SWITCH_ROUTER_MODEL_PREFIX,
  LEGACY_SWITCH_ROUTER_MODEL_PREFIX,
  getSwitchRouterProvider,
  isSwitchRouterModelId,
  stripSwitchRouterModelPrefix,
} from "@/lib/switchRouterIdentity";
import { detectCli } from "@/lib/cliDetect";

const getConfigDir = () => path.join(getRuntimeHomeDir(), ".config", "opencode");
const getConfigPath = () => path.join(getConfigDir(), "opencode.json");

// Detect OpenCode: PATH/global-bin lookup, else a marker directory the CLI or
// the desktop app creates (~/.config/opencode, ~/.local/share/opencode, and the
// Windows desktop-app data dir which ships no PATH shim).
const checkOpenCodeInstalled = async () =>
  (await detectCli({
    commands: ["opencode"],
    markers: [
      getConfigPath(),
      getConfigDir(),
      path.join(getRuntimeHomeDir(), ".opencode"),
      path.join(getRuntimeHomeDir(), ".local", "share", "opencode"),
      process.env.APPDATA ? path.join(process.env.APPDATA, "ai.opencode.desktop") : null,
    ],
  })).installed;

const readConfig = async () => {
  try {
    const content = await fs.readFile(getConfigPath(), "utf-8");
    // opencode config files may use JSONC format (trailing commas, comments).
    // Strip trailing commas before parsing to avoid SyntaxError on valid JSONC.
    const stripped = content.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(stripped);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    // If the config file exists but is unparseable (corrupted, exotic JSONC),
    // treat it as "no config" rather than throwing a 500 that the UI
    // misinterprets as "opencode not installed".
    return null;
  }
};

const hasSwitchRouterConfig = (config) => {
  if (!config?.provider) return false;
  return !!getSwitchRouterProvider(config.provider);
};

// GET - Check opencode CLI and read current settings
export async function GET() {
  try {
    const isInstalled = await checkOpenCodeInstalled();

    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        config: null,
        message: "OpenCode CLI is not installed",
      });
    }

    const config = await readConfig();
    const providerConfig = getSwitchRouterProvider(config?.provider);
    const modelMap = providerConfig?.models || {};

    return NextResponse.json({
      installed: true,
      config,
      hasSwitchRouter: hasSwitchRouterConfig(config),
      configPath: getConfigPath(),
        opencode: {
          models: Object.keys(modelMap),
          activeModel: isSwitchRouterModelId(config?.model) ? stripSwitchRouterModelPrefix(config.model) : null,
          baseURL: providerConfig?.options?.baseURL || null,
        },
    });
  } catch (error) {
    console.log("Error checking opencode settings:", error);
    return NextResponse.json({ error: "Failed to check opencode settings" }, { status: 500 });
  }
}

// POST - Apply Switch-Router as an OpenAI-compatible provider (multi-model support)
export async function POST(request) {
  try {
    const { baseUrl, apiKey, model, models, activeModel, subagentModel } = await request.json();

    // Accept either `model` (string, legacy) or `models` (array of strings)
    const modelsArray = Array.isArray(models) ? models.slice() : (typeof model === "string" ? [model] : []);

    if (!baseUrl || modelsArray.length === 0) {
      return NextResponse.json({ error: "baseUrl and at least one model are required" }, { status: 400 });
    }

    const configDir = getConfigDir();
    const configPath = getConfigPath();

    await fs.mkdir(configDir, { recursive: true });

    // Read existing config or start fresh
    let config = {};
    try {
      const existing = await fs.readFile(configPath, "utf-8");
      config = JSON.parse(existing);
    } catch { /* No existing config */ }

    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    const keyToUse = apiKey || "sk_switch_router";
    const effectiveSubagentModel = subagentModel || modelsArray[0];

    // Ensure provider object
    if (!config.provider) config.provider = {};

    // Preserve an existing Switch-Router or legacy 9router provider entry and its models.
    const existingProvider = getSwitchRouterProvider(config.provider)
      || { npm: "@ai-sdk/openai-compatible", options: {}, models: {} };

    // Merge options (overwrite baseURL/apiKey)
    existingProvider.options = {
      ...existingProvider.options,
      baseURL: normalizedBaseUrl,
      apiKey: keyToUse,
    };

    // Ensure models map exists
    existingProvider.models = existingProvider.models || {};

    // Add or update entries for all requested models
    for (const m of modelsArray) {
      if (!m || typeof m !== "string") continue;
      existingProvider.models[m] = { name: m, modalities: { input: ["text", "image"], output: ["text"] } };
    }

    // Save new configurations under the canonical provider id.
    delete config.provider[LEGACY_SWITCH_ROUTER_PROVIDER];
    config.provider[SWITCH_ROUTER_PROVIDER] = existingProvider;

    // Set the active model: prefer explicit activeModel, else first of modelsArray
    // If activeModel is explicitly empty string, clear the model
    if (activeModel === "") {
      config.model = "";
    } else {
      const finalActive = activeModel || modelsArray[0];
      if (finalActive) {
        config.model = `${SWITCH_ROUTER_MODEL_PREFIX}${finalActive}`;
      }
    }

    // Add subagent configuration
    if (!config.agent) config.agent = {};
    config.agent.explorer = {
      description: "Fast explorer subagent for codebase exploration",
      mode: "subagent",
      model: `${SWITCH_ROUTER_MODEL_PREFIX}${effectiveSubagentModel}`,
    };

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    return NextResponse.json({
      success: true,
      message: "OpenCode settings applied successfully!",
      configPath,
    });
  } catch (error) {
    console.log("Error applying opencode settings:", error);
    return NextResponse.json({ error: "Failed to apply settings" }, { status: 500 });
  }
}

// PATCH - Update specific settings (e.g., clear active model)
export async function PATCH(request) {
  try {
    const { clearActiveModel } = await request.json();
    const configPath = getConfigPath();

    let config = {};
    try {
      const existing = await fs.readFile(configPath, "utf-8");
      config = JSON.parse(existing);
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({ success: true, message: "No config file found" });
      }
      throw error;
    }

    if (clearActiveModel === true) {
      // Clear active model but keep models in the list
      if (isSwitchRouterModelId(config.model)) {
        config.model = "";
      }
    }

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    return NextResponse.json({
      success: true,
      message: "Settings updated",
    });
  } catch (error) {
    console.log("Error patching opencode settings:", error);
    return NextResponse.json({ error: "Failed to patch settings" }, { status: 500 });
  }
}

// DELETE - Remove the Switch-Router provider or specific models from config
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const modelToRemove = searchParams.get("model");
    const configPath = getConfigPath();

    let config = {};
    try {
      const existing = await fs.readFile(configPath, "utf-8");
      config = JSON.parse(existing);
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({ success: true, message: "No config file to reset" });
      }
      throw error;
    }

    const provider = getSwitchRouterProvider(config.provider);
    const providerKey = config.provider?.[SWITCH_ROUTER_PROVIDER]
      ? SWITCH_ROUTER_PROVIDER
      : LEGACY_SWITCH_ROUTER_PROVIDER;
    const providerModelPrefix = providerKey === SWITCH_ROUTER_PROVIDER
      ? SWITCH_ROUTER_MODEL_PREFIX
      : `${LEGACY_SWITCH_ROUTER_PROVIDER}/`;

    // If specific model provided, remove just that model
    if (modelToRemove && provider?.models) {
      delete provider.models[modelToRemove];
      
      // If no models left, remove the provider
      if (Object.keys(provider.models).length === 0) {
        delete config.provider[SWITCH_ROUTER_PROVIDER];
        delete config.provider[LEGACY_SWITCH_ROUTER_PROVIDER];
        if (isSwitchRouterModelId(config.model)) delete config.model;
      } else if (config.model === `${SWITCH_ROUTER_MODEL_PREFIX}${modelToRemove}`
        || config.model === `${LEGACY_SWITCH_ROUTER_MODEL_PREFIX}${modelToRemove}`) {
        // If removed model was active, switch to first remaining model
        const remainingModels = Object.keys(provider.models);
        config.model = `${providerModelPrefix}${remainingModels[0]}`;
      }
    } else {
      // No specific model - remove either canonical or legacy provider.
      if (config.provider) {
        delete config.provider[SWITCH_ROUTER_PROVIDER];
        delete config.provider[LEGACY_SWITCH_ROUTER_PROVIDER];
      }
      if (isSwitchRouterModelId(config.model)) delete config.model;
    }

    // Remove subagent configuration
    if (isSwitchRouterModelId(config.agent?.explorer?.model)) {
      delete config.agent.explorer;
      // Clean up empty agent object
      if (Object.keys(config.agent).length === 0) delete config.agent;
    }

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    return NextResponse.json({
      success: true,
      message: modelToRemove ? `Model "${modelToRemove}" removed` : "Switch-Router settings removed from OpenCode",
    });
  } catch (error) {
    console.log("Error resetting opencode settings:", error);
    return NextResponse.json({ error: "Failed to reset opencode settings" }, { status: 500 });
  }
}
