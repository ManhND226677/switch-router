import fs from "node:fs";
import { getRuntimeHomeDir, joinRuntimePath } from "./runtimePaths.js";

const APP_NAME = "switch-router";
const LEGACY_APP_NAME = "9router";

function defaultDirFor(appName) {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || joinRuntimePath(getRuntimeHomeDir(), "AppData", "Roaming");
    return joinRuntimePath(appData, appName);
  }
  return joinRuntimePath(getRuntimeHomeDir(), `.${appName}`);
}

function defaultDir() {
  const currentDir = defaultDirFor(APP_NAME);
  const legacyDir = defaultDirFor(LEGACY_APP_NAME);

  // Keep existing personal installations usable after the branding migration.
  if (!fs.existsSync(currentDir) && fs.existsSync(legacyDir)) {
    console.info(`[DATA_DIR] Using legacy data directory for compatibility: ${legacyDir}`);
    return legacyDir;
  }

  return currentDir;
}

export function getDataDir() {
  const configured = process.env.DATA_DIR;
  if (!configured) return defaultDir();

  // On Windows, ignore Unix-style absolute paths (e.g. /var/lib/...) that come
  // from a Linux-targeted .env — they are not valid here.
  if (process.platform === "win32" && /^\//.test(configured)) {
    console.warn(`[DATA_DIR] '${configured}' is a Unix path on Windows → fallback to default`);
    return defaultDir();
  }

  try {
    fs.mkdirSync(configured, { recursive: true });
    return configured;
  } catch (e) {
    if (e?.code === "EACCES" || e?.code === "EPERM") {
      console.warn(`[DATA_DIR] '${configured}' not writable → fallback ~/.${APP_NAME}`);
      return defaultDir();
    }
    throw e;
  }
}

export const DATA_DIR = getDataDir();
