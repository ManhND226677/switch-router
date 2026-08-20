"use server";

import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/db/index.js";
import {
  AIZEN_SETTINGS_KEY,
  detectAizenInstalled,
  readJsonFile,
  atomicWriteJson,
  backupFile,
  diskConfigToDashboard,
  mergeDashboardIntoDisk,
  mergeMcpCodebaseMemory,
  endpointMatchFromUrl,
  probeGatewayLive,
  getAizenConfigPath,
  getAizenMcpPath,
  maskApiKey,
} from "@/lib/aizenConfig.js";

function publicSettings(dashboardSettings, dbSnapshot = {}) {
  // Prefer live disk; fill gaps from DB snapshot (e.g. model list extras).
  const models = Array.isArray(dashboardSettings.models) && dashboardSettings.models.length
    ? dashboardSettings.models
    : (Array.isArray(dbSnapshot.models) ? dbSnapshot.models : []);
  return {
    ...dashboardSettings,
    models,
    // DB-only extras the form still tracks
    ...(dbSnapshot.subagentModel && !dashboardSettings.subagentModel
      ? { subagentModel: dbSnapshot.subagentModel }
      : {}),
  };
}

// GET — detect install + read ~/.aizen config (keys masked) + optional live probe
export async function GET(request) {
  try {
    const url = new URL(request?.url || "http://localhost/api/cli-tools/aizen-settings");
    const wantLive = url.searchParams.get("live") === "1";
    const probeKey = url.searchParams.get("probeKey") || ""; // optional key from UI for live check

    const detection = await detectAizenInstalled();
    const disk = await readJsonFile(detection.configPath);
    const mcp = await readJsonFile(detection.mcpPath);
    const fromDisk = diskConfigToDashboard(disk, mcp);

    const db = await getSettings();
    const dbSnapshot = db[AIZEN_SETTINGS_KEY] || {};
    const settings = publicSettings(fromDisk, dbSnapshot);

    const baseUrl = settings.baseUrl || dbSnapshot.baseUrl || "";
    const endpointMatch = endpointMatchFromUrl(baseUrl);
    const hasSwitchRouter = endpointMatch === "configured" && !!(settings.hasApiKey || dbSnapshot.apiKey);

    let live = null;
    if (wantLive) {
      const keyForProbe = probeKey || disk?.api_key || dbSnapshot.apiKey || "";
      live = await probeGatewayLive(baseUrl, keyForProbe);
    }

    return NextResponse.json({
      installed: detection.installed,
      binaryPath: detection.binaryPath,
      configPath: detection.configPath,
      mcpPath: detection.mcpPath,
      detectedVia: detection.via,
      hasSwitchRouter,
      endpointMatch,
      hasConfigFile: !!disk,
      settings,
      live,
      installHint: {
        windows: "Install Aizen CLI, then reopen this page. Config lives in %USERPROFILE%\\.aizen\\cli-config.json",
        configPath: getAizenConfigPath(),
      },
    });
  } catch (error) {
    console.log("Error checking aizen settings:", error);
    return NextResponse.json(
      { error: "Failed to check aizen settings" },
      { status: 500 },
    );
  }
}

// POST — apply: backup + write disk config + mcp + DB snapshot + optional live probe
export async function POST(request) {
  try {
    const body = await request.json();
    const {
      baseUrl,
      apiKey,
      models,
      activeModel,
      subagentModel,
      thinkingEffort,
      autoCompact,
      mcpCodebaseMemory,
      skipDisk = false,
      probe = true,
    } = body || {};

    if (baseUrl !== undefined && baseUrl !== null && typeof baseUrl !== "string") {
      return NextResponse.json({ error: "Invalid baseUrl" }, { status: 400 });
    }
    if (!baseUrl || !String(baseUrl).trim()) {
      return NextResponse.json({ error: "baseUrl is required" }, { status: 400 });
    }
    if (!apiKey || !String(apiKey).trim()) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    }

    const detection = await detectAizenInstalled();
    const configPath = detection.configPath || getAizenConfigPath();
    const existing = (await readJsonFile(configPath)) || {};

    const merged = mergeDashboardIntoDisk(existing, {
      baseUrl,
      apiKey,
      activeModel: activeModel || (Array.isArray(models) && models[0]) || "",
      subagentModel,
      thinkingEffort,
      autoCompact,
    });

    let backupPath = null;
    let wroteDisk = false;
    if (!skipDisk) {
      backupPath = await backupFile(configPath);
      await atomicWriteJson(configPath, merged);
      wroteDisk = true;
    }

    // MCP codebase-memory
    let mcpResult = null;
    if (mcpCodebaseMemory !== undefined) {
      const { mcpPath, next, enabled } = await mergeMcpCodebaseMemory(!!mcpCodebaseMemory);
      if (!skipDisk) {
        await backupFile(mcpPath);
        await atomicWriteJson(mcpPath, next);
      }
      mcpResult = { path: mcpPath, enabled };
    }

    // DB snapshot for dashboard form (never required by CLI, but keeps UI state)
    const dbSnapshot = {
      baseUrl: merged.base_url,
      apiKey: merged.api_key,
      models: Array.isArray(models) && models.length
        ? models
        : (merged.model ? [merged.model] : []),
      activeModel: merged.model || "",
      subagentModel: merged.subagent_model || subagentModel || "",
      thinkingEffort: thinkingEffort === undefined ? null : thinkingEffort,
      autoCompact: !!autoCompact,
      mcpCodebaseMemory: mcpCodebaseMemory === undefined ? false : !!mcpCodebaseMemory,
    };
    await updateSettings({ [AIZEN_SETTINGS_KEY]: dbSnapshot });

    let live = null;
    if (probe) {
      live = await probeGatewayLive(merged.base_url, merged.api_key);
    }

    return NextResponse.json({
      success: true,
      message: wroteDisk
        ? "Aizen CLI config updated on disk and saved."
        : "Aizen settings saved (DB only).",
      wroteDisk,
      backupPath,
      configPath,
      mcp: mcpResult,
      endpointMatch: endpointMatchFromUrl(merged.base_url),
      live,
      settings: diskConfigToDashboard(merged, mcpResult ? { mcpServers: mcpResult.enabled ? { "codebase-memory": {} } : {} } : await readJsonFile(getAizenMcpPath())),
    });
  } catch (error) {
    console.log("Error updating aizen settings:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update aizen settings" },
      { status: 500 },
    );
  }
}

// PATCH — fast toggle fields (disk + DB when installed)
export async function PATCH(request) {
  try {
    const body = await request.json();
    const settings = await getSettings();
    const dbSnapshot = { ...(settings[AIZEN_SETTINGS_KEY] || {}) };

    const allowed = new Set([
      "baseUrl", "apiKey", "activeModel", "subagentModel",
      "thinkingEffort", "autoCompact", "mcpCodebaseMemory",
    ]);
    for (const [key, value] of Object.entries(body || {})) {
      if (allowed.has(key)) dbSnapshot[key] = value;
    }

    // Mirror toggles onto disk when config exists
    const configPath = getAizenConfigPath();
    const existing = await readJsonFile(configPath);
    if (existing) {
      const merged = mergeDashboardIntoDisk(existing, {
        baseUrl: dbSnapshot.baseUrl,
        apiKey: dbSnapshot.apiKey || existing.api_key,
        activeModel: dbSnapshot.activeModel,
        subagentModel: dbSnapshot.subagentModel,
        thinkingEffort: dbSnapshot.thinkingEffort,
        autoCompact: dbSnapshot.autoCompact,
      });
      await backupFile(configPath);
      await atomicWriteJson(configPath, merged);
    }

    if (body && Object.prototype.hasOwnProperty.call(body, "mcpCodebaseMemory")) {
      const { mcpPath, next } = await mergeMcpCodebaseMemory(!!body.mcpCodebaseMemory);
      await backupFile(mcpPath);
      await atomicWriteJson(mcpPath, next);
    }

    await updateSettings({ [AIZEN_SETTINGS_KEY]: dbSnapshot });

    return NextResponse.json({ success: true, message: "Setting updated" });
  } catch (error) {
    console.log("Error patching aizen settings:", error);
    return NextResponse.json({ error: "Failed to update setting" }, { status: 500 });
  }
}

// DELETE — reset Switch-Router wiring or remove one model from DB list
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const modelToRemove = searchParams.get("model");
    const restoreBackup = searchParams.get("restore");

    if (restoreBackup) {
      // restore from explicit backup path (must stay under ~/.aizen)
      const configPath = getAizenConfigPath();
      const home = configPath.slice(0, configPath.toLowerCase().lastIndexOf("cli-config.json") >= 0
        ? configPath.toLowerCase().lastIndexOf("cli-config")
        : 0);
      // Safety: only allow restore of *.bak-* next to config
      if (!restoreBackup.includes("cli-config.json.bak-") && !restoreBackup.endsWith(".bak")) {
        return NextResponse.json({ error: "Invalid backup path" }, { status: 400 });
      }
      const raw = await readJsonFile(restoreBackup);
      if (!raw) return NextResponse.json({ error: "Backup not found" }, { status: 404 });
      await atomicWriteJson(configPath, raw);
      return NextResponse.json({ success: true, message: "Restored from backup", configPath });
    }

    if (modelToRemove) {
      const settings = await getSettings();
      const aizenConfig = { ...(settings[AIZEN_SETTINGS_KEY] || {}) };
      const models = Array.isArray(aizenConfig.models)
        ? aizenConfig.models.filter((m) => m !== modelToRemove)
        : [];
      aizenConfig.models = models;
      if (aizenConfig.activeModel === modelToRemove) {
        aizenConfig.activeModel = models.length > 0 ? models[0] : "";
      }
      if (aizenConfig.subagentModel === modelToRemove) {
        aizenConfig.subagentModel = "";
      }
      await updateSettings({ [AIZEN_SETTINGS_KEY]: aizenConfig });
      return NextResponse.json({ success: true, message: `Model "${modelToRemove}" removed` });
    }

    // Full reset of Switch-Router wiring on disk (keep other providers)
    const configPath = getAizenConfigPath();
    const existing = await readJsonFile(configPath);
    let backupPath = null;
    if (existing) {
      backupPath = await backupFile(configPath);
      const next = { ...existing };
      // If active is Switch-Router / local endpoint, clear main endpoint fields
      // but preserve providers list (user failover profiles).
      const providers = Array.isArray(next.providers) ? next.providers.filter(
        (p) => String(p?.name || "").toLowerCase() !== "switch-router",
      ) : [];
      next.providers = providers;
      if (endpointMatchFromUrl(next.base_url) || next.active_provider === "Switch-Router") {
        // Fall back to first remaining provider if any
        if (providers.length > 0) {
          const p = providers[0];
          next.base_url = p.base_url || next.base_url;
          next.api_key = p.api_key || next.api_key;
          next.model = p.model || next.model;
          next.active_provider = p.name;
        } else {
          delete next.base_url;
          delete next.api_key;
          delete next.model;
          delete next.active_provider;
        }
      }
      await atomicWriteJson(configPath, next);
    }

    await updateSettings({ [AIZEN_SETTINGS_KEY]: {} });

    return NextResponse.json({
      success: true,
      message: "Aizen Switch-Router settings reset",
      backupPath,
      // never echo secrets
      apiKeyHint: existing?.api_key ? maskApiKey(existing.api_key) : "",
    });
  } catch (error) {
    console.log("Error resetting aizen settings:", error);
    return NextResponse.json({ error: "Failed to reset aizen settings" }, { status: 500 });
  }
}
