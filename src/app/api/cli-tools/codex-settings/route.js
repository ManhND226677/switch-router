"use server";

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { parseTOML, stringifyTOML } from "confbox";
import { getRuntimeHomeDir } from "@/lib/runtimePaths";
import { detectCli } from "@/lib/cliDetect";
import {
  SWITCH_ROUTER_PROVIDER,
  LEGACY_SWITCH_ROUTER_PROVIDER,
} from "@/lib/switchRouterIdentity";


const getCodexDir = () => path.join(getRuntimeHomeDir(), ".codex");
const getCodexConfigPath = () => path.join(getCodexDir(), "config.toml");
const getCodexAuthPath = () => path.join(getCodexDir(), "auth.json");

// Flatten confbox-parsed TOML into a writable object, preserving nested tables
const parsedToWritable = (obj) => obj ?? {};

// Set a nested key from a flat dotted path, creating intermediate objects as needed
const setNestedSection = (obj, dottedKey, value) => {
  const keys = dottedKey.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== "object") {
      cur[keys[i]] = {};
    }
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
};

// Delete a nested key from a flat dotted path
const deleteNestedSection = (obj, dottedKey) => {
  const keys = dottedKey.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    cur = cur?.[keys[i]];
    if (cur == null) return;
  }
  delete cur[keys[keys.length - 1]];
};

// Detect Codex: PATH/global-bin lookup (npm/bun/winget layouts), else a marker
// the CLI or the desktop app creates (~/.codex, config.toml, auth.json).
const checkCodexInstalled = async () =>
  (await detectCli({
    commands: ["codex"],
    markers: [
      getCodexConfigPath(),
      getCodexAuthPath(),
      getCodexDir(),
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex") : null,
    ],
  })).installed;

// Read current config.toml
const readConfig = async () => {
  try {
    const configPath = getCodexConfigPath();
    const content = await fs.readFile(configPath, "utf-8");
    return content;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

// Check if config has Switch-Router settings.
const hasSwitchRouterConfig = (config) => {
  if (!config) return false;
  return config.includes(`model_provider = "${SWITCH_ROUTER_PROVIDER}"`)
    || config.includes(`model_provider = "${LEGACY_SWITCH_ROUTER_PROVIDER}"`)
    || config.includes(`[model_providers.${SWITCH_ROUTER_PROVIDER}]`)
    || config.includes(`[model_providers.${LEGACY_SWITCH_ROUTER_PROVIDER}]`);
};

// GET - Check codex CLI and read current settings
export async function GET() {
  try {
    const isInstalled = await checkCodexInstalled();
    
    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        config: null,
        message: "Codex CLI is not installed",
      });
    }

    const config = await readConfig();

    return NextResponse.json({
      installed: true,
      config,
      hasSwitchRouter: hasSwitchRouterConfig(config),
      configPath: getCodexConfigPath(),
    });
  } catch (error) {
    console.error("Error checking codex settings:", error);
    return NextResponse.json({ error: "Failed to check codex settings" }, { status: 500 });
  }
}

// POST - Update Switch-Router settings (merge with existing config)
export async function POST(request) {
  try {
    const { baseUrl, apiKey, model, subagentModel } = await request.json();
    
    if (!baseUrl || !apiKey || !model) {
      return NextResponse.json({ error: "baseUrl, apiKey and model are required" }, { status: 400 });
    }

    const codexDir = getCodexDir();
    const configPath = getCodexConfigPath();

    // Ensure directory exists
    await fs.mkdir(codexDir, { recursive: true });

    // Read and parse existing config
    let parsed = {};
    try {
      const existingConfig = await fs.readFile(configPath, "utf-8");
      parsed = parsedToWritable(parseTOML(existingConfig));
    } catch { /* No existing config */ }

    // Update only Switch-Router related fields (api_key goes to auth.json, not config.toml)
    parsed.model = model;
    parsed.model_provider = SWITCH_ROUTER_PROVIDER;

    // Update or create the canonical provider section (no api_key - Codex reads from auth.json).
    // Ensure /v1 suffix is added only once
    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    deleteNestedSection(parsed, `model_providers.${LEGACY_SWITCH_ROUTER_PROVIDER}`);
    setNestedSection(parsed, `model_providers.${SWITCH_ROUTER_PROVIDER}`, {
      name: "Switch-Router",
      base_url: normalizedBaseUrl,
      wire_api: "responses",
    });

    // Add subagent configuration
    const effectiveSubagentModel = subagentModel || model;
    setNestedSection(parsed, "agents.subagent", {
      model: effectiveSubagentModel,
    });

    // Write merged config
    const configContent = stringifyTOML(parsed);
    await fs.writeFile(configPath, configContent);

    // Update auth.json with OPENAI_API_KEY (Codex reads this first)
    const authPath = getCodexAuthPath();
    let authData = {};
    try {
      const existingAuth = await fs.readFile(authPath, "utf-8");
      authData = JSON.parse(existingAuth);
    } catch { /* No existing auth */ }
    
    // Force apikey mode (keep existing tokens untouched for ChatGPT login reuse)
    authData.OPENAI_API_KEY = apiKey;
    authData.auth_mode = "apikey";
    await fs.writeFile(authPath, JSON.stringify(authData, null, 2));

    return NextResponse.json({
      success: true,
      message: "Codex settings applied successfully!",
      configPath,
    });
  } catch (error) {
    console.error("Error updating codex settings:", error);
    return NextResponse.json({ error: "Failed to update codex settings" }, { status: 500 });
  }
}

// DELETE - Remove Switch-Router settings only (keep other settings)
export async function DELETE() {
  try {
    const configPath = getCodexConfigPath();

    // Read and parse existing config
    let parsed = {};
    try {
      const existingConfig = await fs.readFile(configPath, "utf-8");
      parsed = parsedToWritable(parseTOML(existingConfig));
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({
          success: true,
          message: "No config file to reset",
        });
      }
      throw error;
    }

    // Remove Switch-Router related root fields only if they point to our provider.
    if (parsed.model_provider === SWITCH_ROUTER_PROVIDER
      || parsed.model_provider === LEGACY_SWITCH_ROUTER_PROVIDER) {
      delete parsed.model;
      delete parsed.model_provider;
    }

    // Remove both canonical and legacy provider sections.
    deleteNestedSection(parsed, `model_providers.${SWITCH_ROUTER_PROVIDER}`);
    deleteNestedSection(parsed, `model_providers.${LEGACY_SWITCH_ROUTER_PROVIDER}`);

    // Remove subagent configuration
    deleteNestedSection(parsed, "agents.subagent");

    // Write updated config
    const configContent = stringifyTOML(parsed);
    await fs.writeFile(configPath, configContent);

    // Remove OPENAI_API_KEY from auth.json
    const authPath = getCodexAuthPath();
    try {
      const existingAuth = await fs.readFile(authPath, "utf-8");
      const authData = JSON.parse(existingAuth);
      delete authData.OPENAI_API_KEY;
      delete authData.auth_mode;

      // Write back or delete if empty
      if (Object.keys(authData).length === 0) {
        await fs.unlink(authPath);
      } else {
        await fs.writeFile(authPath, JSON.stringify(authData, null, 2));
      }
    } catch { /* No auth file */ }

    return NextResponse.json({
      success: true,
      message: "Switch-Router settings removed successfully",
    });
  } catch (error) {
    console.error("Error resetting codex settings:", error);
    return NextResponse.json({ error: "Failed to reset codex settings" }, { status: 500 });
  }
}
