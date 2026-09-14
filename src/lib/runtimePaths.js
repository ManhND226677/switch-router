import { homedir as systemHomeDir } from "node:os";

// Keep host-specific paths runtime-only. Next's file tracer must not evaluate
// the user's home directory as a build-time asset root on Windows.
const USER_PROFILE_KEY = ["USER", "PROFILE"].join("");
const HOME_KEY = ["H", "O", "M", "E"].join("");

export function getRuntimeHomeDir() {
  return process.env[USER_PROFILE_KEY]
    || process.env[HOME_KEY]
    || systemHomeDir();
}

// Do not use path.join for host-specific paths in route modules. Next's file
// tracer interprets those calls as build-time asset references. These paths
// are only used by runtime auto-import/configuration handlers.
export function joinRuntimePath(base, ...parts) {
  return [base, ...parts].join(process.platform === "win32" ? "\\" : "/");
}

export async function accessRuntimePath(filePath, mode) {
  // Keep the filesystem probe deferred until a request reaches the handler.
  // The path itself is already runtime-only, so a literal built-in import keeps
  // webpack's dependency graph statically analyzable without exposing a host
  // filesystem root to Next's file tracer.
  const runtimeFs = await import("node:fs/promises");
  return runtimeFs.access(filePath, mode);
}
