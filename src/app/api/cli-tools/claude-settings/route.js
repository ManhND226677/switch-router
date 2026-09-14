"use server";

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getRuntimeHomeDir } from "@/lib/runtimePaths";
import { detectCli, getClaudeDesktopMarkers } from "@/lib/cliDetect";

// Get claude settings path based on OS
const getClaudeSettingsPath = () => {
  const homeDir = getRuntimeHomeDir();
  return path.join(homeDir, ".claude", "settings.json");
};

const getClaudeDir = () => path.join(getRuntimeHomeDir(), ".claude");

// Detect Claude Code: PATH/global-bin lookup, else a marker left by the CLI
// (~/.claude, ~/.claude.json), else Claude Desktop — which bundles the Claude
// Code engine ("Claude Code for Desktop") and, when installed from the Store as
// an MSIX package, exposes neither a PATH shim nor ~/.claude.
const checkClaudeInstalled = async () =>
  detectCli({
    commands: ["claude"],
    markers: [
      getClaudeSettingsPath(),
      getClaudeDir(),
      path.join(getRuntimeHomeDir(), ".claude.json"),
      path.join(getClaudeDir(), ".credentials.json"),
      ...(await getClaudeDesktopMarkers()),
    ],
  });

// Read current settings
const readSettings = async () => {
  try {
    const settingsPath = getClaudeSettingsPath();
    const content = await fs.readFile(settingsPath, "utf-8");
    // Tolerate JSONC (trailing commas) and treat unparseable files as "no config"
    // rather than throwing a 500 that the UI misreads as "tool not installed".
    const stripped = content.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(stripped);
  } catch (error) {
    return null;
  }
};

// GET - Check claude CLI and read current settings
export async function GET() {
  try {
    const detection = await checkClaudeInstalled();

    if (!detection.installed) {
      return NextResponse.json({
        installed: false,
        settings: null,
        message: "Claude CLI is not installed",
      });
    }

    const settings = await readSettings();
    const hasSwitchRouter = !!(settings?.env?.ANTHROPIC_BASE_URL);

    return NextResponse.json({
      installed: true,
      settings: settings,
      hasSwitchRouter,
      settingsPath: getClaudeSettingsPath(),
      detectedVia: detection.via,
      detectedPath: detection.path,
    });
  } catch (error) {
    console.error("Error checking claude settings:", error);
    return NextResponse.json(
      { error: "Failed to check claude settings" },
      { status: 500 }
    );
  }
}

// POST - Backup old fields and write new settings
export async function POST(request) {
  try {
    const { env } = await request.json();
    
    if (!env || typeof env !== "object") {
      return NextResponse.json(
        { error: "Invalid env object" },
        { status: 400 }
      );
    }

    const settingsPath = getClaudeSettingsPath();
    const claudeDir = path.dirname(settingsPath);

    // Ensure .claude directory exists
    await fs.mkdir(claudeDir, { recursive: true });

    // Read current settings
    let currentSettings = {};
    try {
      const content = await fs.readFile(settingsPath, "utf-8");
      currentSettings = JSON.parse(content);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    // Normalize ANTHROPIC_BASE_URL: the Anthropic SDK appends /v1 itself, so the
    // stored base must NOT carry a /v1 suffix (since 0.9.0 there is no /v1/v1
    // rewrite — a suffixed URL would hit /v1/v1/messages → 404).
    if (env.ANTHROPIC_BASE_URL) {
      env.ANTHROPIC_BASE_URL = env.ANTHROPIC_BASE_URL.replace(/\/+$/, "").replace(/\/v1$/i, "") || env.ANTHROPIC_BASE_URL;
      if (env.ANTHROPIC_BASE_URL === "") {
        delete env.ANTHROPIC_BASE_URL;
      }
    }

    // Merge new env with existing settings
    const newSettings = {
      ...currentSettings,
      hasCompletedOnboarding: true,
      env: {
        ...(currentSettings.env || {}),
        ...env,
      },
    };

    // Write new settings
    await fs.writeFile(settingsPath, JSON.stringify(newSettings, null, 2));

    return NextResponse.json({
      success: true,
      message: "Settings updated successfully",
    });
  } catch (error) {
    console.error("Error updating claude settings:", error);
    return NextResponse.json(
      { error: "Failed to update claude settings" },
      { status: 500 }
    );
  }
}

// Fields to remove when resetting
const RESET_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "API_TIMEOUT_MS",
];

// DELETE - Reset settings (remove env fields)
export async function DELETE() {
  try {
    const settingsPath = getClaudeSettingsPath();

    // Read current settings
    let currentSettings = {};
    try {
      const content = await fs.readFile(settingsPath, "utf-8");
      currentSettings = JSON.parse(content);
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({
          success: true,
          message: "No settings file to reset",
        });
      }
      throw error;
    }

    // Remove specified env fields
    if (currentSettings.env) {
      RESET_ENV_KEYS.forEach((key) => {
        delete currentSettings.env[key];
      });
      
      // Clean up empty env object
      if (Object.keys(currentSettings.env).length === 0) {
        delete currentSettings.env;
      }
    }

    // Write updated settings
    await fs.writeFile(settingsPath, JSON.stringify(currentSettings, null, 2));

    return NextResponse.json({
      success: true,
      message: "Settings reset successfully",
    });
  } catch (error) {
    console.error("Error resetting claude settings:", error);
    return NextResponse.json(
      { error: "Failed to reset claude settings" },
      { status: 500 }
    );
  }
}
