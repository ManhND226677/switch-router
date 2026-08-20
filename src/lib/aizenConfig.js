/**
 * Aizen CLI config helpers — paths, detect, read/write ~/.aizen/cli-config.json
 * and ~/.aizen/mcp.json. Used by /api/cli-tools/aizen-settings.
 *
 * Field map (dashboard ↔ disk):
 *   baseUrl          ↔ base_url (+ providers[active].base_url)
 *   apiKey           ↔ api_key  (+ providers[active].api_key)
 *   activeModel      ↔ model
 *   subagentModel    ↔ roles.subagent_default.model  (via CLI --subagent-model shape we store as subagent_model)
 *   thinkingEffort   ↔ reasoning_effort
 *   autoCompact      ↔ compact_threshold_pct (60 when on, 0 when off)
 *   mcpCodebaseMemory↔ mcp.json mcpServers["codebase-memory"]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { getRuntimeHomeDir, joinRuntimePath } from "@/lib/runtimePaths";
import { detectCli, findExecutable, pathExists } from "@/lib/cliDetect";

// Keep server-side — do not import from dashboard client components.
function matchKnownEndpoint(currentUrl) {
  if (!currentUrl) return false;
  const url = String(currentUrl).replace(/\/+$/, "");
  return /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url);
}

export const AIZEN_SETTINGS_KEY = "aizenConfig";
export const SWITCH_ROUTER_PROVIDER_NAME = "Switch-Router";

export function getAizenHomeDir() {
  return joinRuntimePath(getRuntimeHomeDir(), ".aizen");
}

export function getAizenConfigPath() {
  return joinRuntimePath(getAizenHomeDir(), "cli-config.json");
}

export function getAizenMcpPath() {
  return joinRuntimePath(getAizenHomeDir(), "mcp.json");
}

export async function detectAizenInstalled() {
  const home = getAizenHomeDir();
  const configPath = getAizenConfigPath();
  const localAppData = process.env.LOCALAPPDATA || joinRuntimePath(getRuntimeHomeDir(), "AppData", "Local");

  const detection = await detectCli({
    commands: ["aizen"],
    markers: [
      configPath,
      home,
      joinRuntimePath(localAppData, "Aizen", "aizen.exe"),
      joinRuntimePath(localAppData, "aizen", "aizen.exe"),
    ],
  });

  // Prefer direct Local\Aizen\aizen.exe when PATH miss
  let binaryPath = detection.path || null;
  if (!binaryPath) {
    binaryPath = await findExecutable(["aizen"]);
  }
  if (!binaryPath) {
    const candidates = [
      joinRuntimePath(localAppData, "Aizen", "aizen.exe"),
      joinRuntimePath(localAppData, "aizen", "aizen.exe"),
    ];
    for (const c of candidates) {
      if (await pathExists(c)) {
        binaryPath = c;
        break;
      }
    }
  }

  const installed = !!(detection.installed || binaryPath || (await pathExists(configPath)) || (await pathExists(home)));

  return {
    installed,
    binaryPath,
    configPath,
    mcpPath: getAizenMcpPath(),
    homeDir: home,
    via: detection.via || (binaryPath ? "path" : (await pathExists(home) ? "marker" : null)),
  };
}

export async function readJsonFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const stripped = raw.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(stripped);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    // Unparseable → treat as empty rather than 500
    return null;
  }
}

export async function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const body = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(tmp, body, "utf8");
  await fs.rename(tmp, filePath);
}

export async function backupFile(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    return null;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bak = `${filePath}.bak-${stamp}`;
  await fs.copyFile(filePath, bak);
  return bak;
}

/** Mask secrets for dashboard GET responses. */
export function maskApiKey(key) {
  if (!key || typeof key !== "string") return "";
  if (key.length <= 8) return "***";
  return `${key.slice(0, 3)}***${key.slice(-4)}`;
}

export function diskConfigToDashboard(disk, mcp = null) {
  if (!disk || typeof disk !== "object") {
    return {
      baseUrl: "",
      apiKey: "",
      apiKeyMasked: "",
      models: [],
      activeModel: "",
      subagentModel: "",
      thinkingEffort: null,
      autoCompact: false,
      mcpCodebaseMemory: false,
      activeProvider: null,
      providers: [],
    };
  }

  const baseUrl = disk.base_url || "";
  const apiKey = disk.api_key || "";
  const activeModel = disk.model || "";
  const providers = Array.isArray(disk.providers) ? disk.providers : [];
  const models = [];
  if (activeModel) models.push(activeModel);
  for (const p of providers) {
    if (p?.model && !models.includes(p.model)) models.push(p.model);
  }

  // subagent: Aizen may store under roles.subagent_default.model
  const subagentModel =
    disk.subagent_model
    || disk.roles?.subagent_default?.model
    || "";

  const effort = disk.reasoning_effort;
  const thinkingEffort = (effort === "low" || effort === "medium" || effort === "high" || effort === "xhigh" || effort === "max")
    ? (effort === "xhigh" || effort === "max" ? "high" : effort)
    : null;

  const compactPct = Number(disk.compact_threshold_pct);
  const autoCompact = Number.isFinite(compactPct) ? compactPct > 0 : false;

  const mcpServers = mcp?.mcpServers && typeof mcp.mcpServers === "object" ? mcp.mcpServers : {};
  const mcpCodebaseMemory = !!(mcpServers["codebase-memory"] || mcpServers["mcp-codebase-memory"]);

  return {
    baseUrl,
    apiKey: "", // never return raw key
    apiKeyMasked: maskApiKey(apiKey),
    hasApiKey: !!apiKey,
    models,
    activeModel,
    subagentModel,
    thinkingEffort,
    autoCompact,
    mcpCodebaseMemory,
    activeProvider: disk.active_provider || null,
    providers: providers.map((p) => ({
      name: p.name,
      baseUrl: p.base_url || "",
      model: p.model || "",
      apiKeyMasked: maskApiKey(p.api_key),
      hasApiKey: !!p.api_key,
    })),
    reasoningEffortRaw: disk.reasoning_effort || null,
    compactThresholdPct: Number.isFinite(compactPct) ? compactPct : null,
  };
}

/**
 * Merge dashboard apply payload into existing disk config without wiping
 * unrelated fields (approval_mode, icons, other providers, …).
 */
export function mergeDashboardIntoDisk(existing, payload) {
  const next = existing && typeof existing === "object" ? { ...existing } : {};
  const providers = Array.isArray(next.providers)
    ? next.providers.map((p) => ({ ...p }))
    : [];

  const baseUrl = typeof payload.baseUrl === "string" ? payload.baseUrl.trim() : "";
  const apiKey = typeof payload.apiKey === "string" ? payload.apiKey.trim() : "";
  const activeModel = typeof payload.activeModel === "string"
    ? payload.activeModel.trim()
    : (Array.isArray(payload.models) && payload.models[0]) || "";
  const subagentModel = payload.subagentModel !== undefined
    ? String(payload.subagentModel || "").trim()
    : undefined;

  if (baseUrl) next.base_url = baseUrl.replace(/\/+$/, "");
  if (apiKey) next.api_key = apiKey;
  if (activeModel) next.model = activeModel;

  // Upsert Switch-Router provider profile and activate it when wiring local gateway.
  const isLocal = matchKnownEndpoint(next.base_url || baseUrl);
  if (isLocal && (next.base_url || baseUrl) && (next.api_key || apiKey)) {
    const idx = providers.findIndex(
      (p) => String(p.name || "").toLowerCase() === SWITCH_ROUTER_PROVIDER_NAME.toLowerCase(),
    );
    const profile = {
      name: SWITCH_ROUTER_PROVIDER_NAME,
      base_url: next.base_url,
      api_key: next.api_key,
      model: next.model || activeModel || "",
    };
    if (idx >= 0) providers[idx] = { ...providers[idx], ...profile };
    else providers.push(profile);
    next.active_provider = SWITCH_ROUTER_PROVIDER_NAME;
  }
  next.providers = providers;

  // Subagent model — store both flat + roles shape for forward compat
  if (subagentModel !== undefined) {
    if (subagentModel) {
      next.subagent_model = subagentModel;
      next.roles = {
        ...(next.roles || {}),
        subagent_default: {
          ...(next.roles?.subagent_default || {}),
          model: subagentModel,
        },
      };
    } else {
      delete next.subagent_model;
      if (next.roles?.subagent_default) {
        const { model: _m, ...rest } = next.roles.subagent_default;
        if (Object.keys(rest).length) next.roles.subagent_default = rest;
        else {
          const { subagent_default: _s, ...rolesRest } = next.roles;
          next.roles = Object.keys(rolesRest).length ? rolesRest : undefined;
        }
      }
    }
  }

  // Thinking / reasoning
  if (payload.thinkingEffort !== undefined) {
    if (payload.thinkingEffort === null || payload.thinkingEffort === "" || payload.thinkingEffort === "none") {
      delete next.reasoning_effort;
      // leave auto_effort alone
    } else {
      const map = { low: "low", medium: "medium", high: "high" };
      next.reasoning_effort = map[payload.thinkingEffort] || String(payload.thinkingEffort);
      next.auto_effort = false;
    }
  }

  // Auto-compact → compact_threshold_pct (0 disables; 60 default when on)
  if (payload.autoCompact !== undefined) {
    next.compact_threshold_pct = payload.autoCompact ? 60 : 0;
  }

  next.onboarded = true;
  return next;
}

export async function mergeMcpCodebaseMemory(enabled) {
  const mcpPath = getAizenMcpPath();
  const current = (await readJsonFile(mcpPath)) || {};
  const servers = { ...(current.mcpServers || {}) };

  if (enabled) {
    if (!servers["codebase-memory"] && !servers["mcp-codebase-memory"]) {
      // Prefer known Windows install path; user can edit later.
      const localAppData = process.env.LOCALAPPDATA || joinRuntimePath(getRuntimeHomeDir(), "AppData", "Local");
      const defaultExe = joinRuntimePath(
        localAppData,
        "Programs",
        "codebase-memory-mcp",
        "codebase-memory-mcp.exe",
      );
      const exe = (await pathExists(defaultExe)) ? defaultExe : "codebase-memory-mcp";
      servers["codebase-memory"] = {
        command: exe,
        args: ["stdio"],
      };
    }
  } else {
    delete servers["codebase-memory"];
    delete servers["mcp-codebase-memory"];
  }

  const next = { ...current, mcpServers: servers };
  // Drop empty mcpServers
  if (Object.keys(servers).length === 0) {
    delete next.mcpServers;
  }
  return { mcpPath, next, enabled: !!(servers["codebase-memory"] || servers["mcp-codebase-memory"]) };
}

export function endpointMatchFromUrl(url) {
  if (!url) return "not_configured";
  if (matchKnownEndpoint(url)) return "configured";
  return "other";
}

export async function probeGatewayLive(baseUrl, apiKey, { timeoutMs = 8000 } = {}) {
  if (!baseUrl || !apiKey) {
    return { ok: false, error: "Missing baseUrl or apiKey" };
  }
  const root = String(baseUrl).replace(/\/+$/, "");
  const url = /\/v\d+$/i.test(root) ? `${root}/models` : `${root}/v1/models`;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return { ok: false, status: res.status, latencyMs, error: `HTTP ${res.status}` };
    }
    const json = await res.json().catch(() => null);
    const list = Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : []);
    return {
      ok: true,
      status: res.status,
      latencyMs,
      modelCount: list.length,
      sampleIds: list.slice(0, 5).map((m) => m?.id || m?.name).filter(Boolean),
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err.name === "TimeoutError" ? "timeout" : (err.message || "network error"),
    };
  }
}
