// Shared CLI-tool detection for the dashboard's /api/cli-tools/* routes.
//
// Why this exists: the routes used to decide "installed" with a bare
// `where <cmd>` / `which <cmd>` plus a single config-file probe. That misses
// every real-world install layout that is not on the PATH the Next process
// happens to inherit (tray/service launch, Bun/pnpm/winget/scoop global bins,
// desktop-app installs that ship no shim on PATH). Result: tools that clearly
// exist on the machine were reported as "Not installed".
//
// Detection order: PATH lookup (with the usual global bin dirs injected) →
// direct probe of those bin dirs (incl. Windows executable extensions) →
// per-tool marker files/dirs (config or data directory the tool created).

import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import { getRuntimeHomeDir, joinRuntimePath } from "@/lib/runtimePaths";

const execAsync = promisify(exec);
const isWindows = process.platform === "win32";

// Windows executable extensions a global npm/bun install may produce.
const WIN_EXECUTABLE_EXTS = [".cmd", ".exe", ".bat", ".ps1", ""];

export const pathExists = async (filePath) => {
  if (!filePath) return false;
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

// Global bin directories that commonly hold AI CLIs but are frequently absent
// from the PATH inherited by a background-launched server process.
export const getExtraBinDirs = () => {
  const home = getRuntimeHomeDir();
  const dirs = [
    joinRuntimePath(home, ".bun", "bin"),
    joinRuntimePath(home, ".local", "bin"),
    joinRuntimePath(home, ".local", "share", "npm", "bin"),
    joinRuntimePath(home, ".deno", "bin"),
    joinRuntimePath(home, ".cargo", "bin"),
  ];

  if (isWindows) {
    const appData = process.env.APPDATA;
    const localAppData = process.env.LOCALAPPDATA;
    if (appData) dirs.push(joinRuntimePath(appData, "npm"));
    if (localAppData) {
      dirs.push(joinRuntimePath(localAppData, "pnpm"));
      dirs.push(joinRuntimePath(localAppData, "Microsoft", "WinGet", "Links"));
      dirs.push(joinRuntimePath(localAppData, "Programs"));
    }
    dirs.push(joinRuntimePath(home, "scoop", "shims"));
    dirs.push("C:\\ProgramData\\chocolatey\\bin");
  } else {
    dirs.push("/usr/local/bin", "/opt/homebrew/bin", joinRuntimePath(home, ".npm-global", "bin"));
  }

  return dirs;
};

const buildLookupPath = () => {
  const separator = isWindows ? ";" : ":";
  const seen = new Set();
  const parts = [];
  for (const dir of [...getExtraBinDirs(), ...String(process.env.PATH || "").split(separator)]) {
    const value = String(dir || "").trim();
    if (!value) continue;
    const key = isWindows ? value.toLowerCase() : value;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(value);
  }
  return parts.join(separator);
};

// Resolve the first of `commands` that exists, returning its absolute path.
export const findExecutable = async (commands = []) => {
  const names = commands.filter(Boolean);
  if (names.length === 0) return null;

  const lookup = isWindows ? "where" : "which";
  const env = { ...process.env, PATH: buildLookupPath() };

  for (const name of names) {
    try {
      const { stdout } = await execAsync(`${lookup} ${name}`, { windowsHide: true, env });
      const hit = String(stdout || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      if (hit) return hit;
    } catch {
      // not on PATH — fall through to the direct probe below
    }
  }

  const exts = isWindows ? WIN_EXECUTABLE_EXTS : [""];
  for (const dir of getExtraBinDirs()) {
    for (const name of names) {
      for (const ext of exts) {
        const candidate = joinRuntimePath(dir, `${name}${ext}`);
        if (await pathExists(candidate)) return candidate;
      }
    }
  }

  return null;
};

// Resolve the first child directory of `parent` whose name starts with
// `prefix`. Windows MSIX/Store apps live in
// %LOCALAPPDATA%\Packages\<Name>_<publisherHash>, so the exact folder name is
// not knowable up front — only its prefix.
export const findChildDirByPrefix = async (parent, prefix) => {
  if (!parent || !prefix) return null;
  try {
    const entries = await fs.readdir(parent, { withFileTypes: true });
    const needle = prefix.toLowerCase();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.toLowerCase().startsWith(needle)) return joinRuntimePath(parent, entry.name);
    }
  } catch {
    // parent unreadable / missing — treated as "no match"
  }
  return null;
};

// Marker paths that prove Claude Desktop is present. Covers the classic
// installer layout AND the MSIX/Store package, whose per-user data is
// redirected under Packages\Claude_*\LocalCache\Roaming\Claude (so neither a
// PATH shim nor ~/.claude ever exists for that install type).
export const getClaudeDesktopMarkers = async () => {
  const home = getRuntimeHomeDir();
  const appData = process.env.APPDATA || joinRuntimePath(home, "AppData", "Roaming");
  const localAppData = process.env.LOCALAPPDATA || joinRuntimePath(home, "AppData", "Local");

  const markers = [];
  if (process.platform === "win32") {
    const pkgRoot = await findChildDirByPrefix(joinRuntimePath(localAppData, "Packages"), "Claude_");
    if (pkgRoot) markers.push(joinRuntimePath(pkgRoot, "LocalCache", "Roaming", "Claude"));
    markers.push(
      joinRuntimePath(localAppData, "AnthropicClaude"),
      joinRuntimePath(localAppData, "Claude-3p"),
      joinRuntimePath(appData, "Claude-3p"),
      joinRuntimePath(appData, "Claude")
    );
  } else if (process.platform === "darwin") {
    const support = joinRuntimePath(home, "Library", "Application Support");
    markers.push("/Applications/Claude.app", joinRuntimePath(support, "Claude-3p"), joinRuntimePath(support, "Claude"));
  } else {
    markers.push(joinRuntimePath(home, ".config", "Claude-3p"), joinRuntimePath(home, ".config", "Claude"));
  }
  return markers;
};

// Detect a CLI tool: PATH/bin probe first, then any marker path it leaves behind.
// Returns { installed, via: "path" | "marker" | null, path }.
export const detectCli = async ({ commands = [], markers = [] } = {}) => {
  const executable = await findExecutable(commands);
  if (executable) return { installed: true, via: "path", path: executable };

  for (const marker of markers.filter(Boolean)) {
    if (await pathExists(marker)) return { installed: true, via: "marker", path: marker };
  }

  return { installed: false, via: null, path: null };
};

// Convenience wrapper for the routes that only need the boolean.
export const isCliInstalled = async (spec) => (await detectCli(spec)).installed;
