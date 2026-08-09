import { execSync } from "child_process";

const KILL_TIMEOUT_MS = 5000;
const PROCESS_WAIT_MS = 1500;

// Collect only processes belonging to this local gateway before shutdown.
function collectAppPids() {
  const pids = new Set();
  const platform = process.platform;

  if (platform === "win32") {
    try {
      const psCmd = `powershell -NonInteractive -WindowStyle Hidden -Command "Get-WmiObject Win32_Process -Filter 'Name=\\"node.exe\\"' | Select-Object ProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation"`;
      const output = execSync(psCmd, {
        encoding: "utf8",
        windowsHide: true,
        timeout: KILL_TIMEOUT_MS,
      });

      output.split("\n").slice(1).filter(Boolean).forEach((line) => {
        const commandLine = line.toLowerCase();
        const isAppProcess = commandLine.includes("switch-router")
          || commandLine.includes("9router")
          || commandLine.includes("next-server");
        const match = line.match(/^"(\d+)"/);
        if (isAppProcess && match?.[1] && match[1] !== String(process.pid)) {
          pids.add(match[1]);
        }
      });
    } catch {
      // No matching processes or process inspection unavailable.
    }
  } else {
    try {
      execSync("ps aux 2>/dev/null", { encoding: "utf8", timeout: KILL_TIMEOUT_MS })
        .split("\n")
        .forEach((line) => {
          const commandLine = line.toLowerCase();
          const isAppProcess = commandLine.includes("switch-router")
            || commandLine.includes("9router")
            || commandLine.includes("next-server");
          const pid = line.trim().split(/\s+/)[1];
          if (isAppProcess && pid && /^\d+$/.test(pid) && pid !== String(process.pid)) {
            pids.add(pid);
          }
        });
    } catch {
      // No matching processes or process inspection unavailable.
    }
  }

  return [...pids];
}

function isProcessAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

export async function killAppProcesses() {
  const pids = collectAppPids();
  const GRACE_MS = 3000;

  // 1) Ask nicely first so adapters can flush (sql.js debounce / WAL checkpoint).
  for (const pid of pids) {
    const n = Number(pid);
    if (!isProcessAlive(n)) continue;
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /PID ${n} 2>nul`, { stdio: "ignore", windowsHide: true, timeout: GRACE_MS });
      } else {
        process.kill(n, "SIGTERM");
      }
    } catch {
      // Ignore — force-kill below if still alive.
    }
  }

  // 2) Wait (bounded) for graceful exit.
  const deadline = Date.now() + GRACE_MS;
  while (Date.now() < deadline && pids.some((p) => isProcessAlive(Number(p)))) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  // 3) Force-kill anything still alive.
  for (const pid of pids) {
    const n = Number(pid);
    if (!isProcessAlive(n)) continue;
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /F /PID ${n} 2>nul`, { stdio: "ignore", windowsHide: true, timeout: GRACE_MS });
      } else {
        process.kill(n, "SIGKILL");
      }
    } catch {
      // Process may have just exited.
    }
  }

  if (pids.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, PROCESS_WAIT_MS));
  }
}
