// Run Vitest even when known failures exist, then let the regression verifier
// decide whether the run is acceptable. This avoids shell-specific `|| true`.
import { existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve, delimiter } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testsDir = resolve(root, "tests");
const reportPath = resolve(testsDir, ".vitest-reports", "current-results.json");
const npmCommand = "npm";

// --- Node version guard -----------------------------------------------------
// better-sqlite3's native binding in this repo is compiled for Node 24
// (NODE_MODULE_VERSION 137). On Node 22 (ABI 127) it fails to load with
// ERR_DLOPEN_FAILED, which makes the DB-backed tests fail and produces a
// MISLEADING "pass→fail" regression in the gate — looking exactly like a real
// code break and risking a blocked merge. Fail loudly instead of silently
// emitting a false negative.
const NODE_MAJOR = Number(process.versions.node.split(".")[0]);
if (NODE_MAJOR < 24) {
  console.error(
    `\n❌ qa-gate requires Node >= 24 (better-sqlite3 native binding is built for Node 24; ` +
    `current Node ${process.versions.node} cannot load it).\n` +
    `   Use the system Node 24, e.g.:\n` +
    `     "C:/Program Files/nodejs/node.exe" scripts/qa-gate.mjs\n` +
    `   or:  nvm use 24 && npm run gate\n`
  );
  process.exit(2);
}

function run(command, args, cwd, shell = false, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell,
    env,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

// Force the test runner to use the SAME Node that launched this script.
// Without this, `npm` resolved from PATH may pick a different Node (e.g. a
// managed Node 22), breaking the better-sqlite3 binding and producing the
// false regression described above. Prepending the launcher's bin dir to PATH
// guarantees `npm`/`vitest` run under the intended Node.
const nodeBinDir = dirname(process.execPath);
const gateEnv = { ...process.env, PATH: `${nodeBinDir}${delimiter}${process.env.PATH}` };

rmSync(reportPath, { force: true });
const testStatus = run(npmCommand, ["run", "test:report"], testsDir, process.platform === "win32", gateEnv);
if (!existsSync(reportPath)) {
  console.error(`Vitest did not write its report: ${reportPath}`);
  process.exit(testStatus || 1);
}

process.exit(
  run(process.execPath, [
    resolve(testsDir, "__baseline__", "verify-no-regression.mjs"),
    reportPath,
  ], testsDir, false),
);
