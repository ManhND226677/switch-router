// Probe the shared CLI-tool detector the dashboard uses, straight from Node.
// Run: node --import ./scripts/alias-register.mjs scripts/check-cli-detect.mjs
import path from "node:path";
import { detectCli, getExtraBinDirs, getClaudeDesktopMarkers } from "@/lib/cliDetect";
import { getRuntimeHomeDir } from "@/lib/runtimePaths";

const home = getRuntimeHomeDir();
const appData = process.env.APPDATA;
const localAppData = process.env.LOCALAPPDATA;

const SPECS = {
  claude: {
    commands: ["claude"],
    markers: [
      path.join(home, ".claude", "settings.json"),
      path.join(home, ".claude"),
      path.join(home, ".claude.json"),
      ...(await getClaudeDesktopMarkers()),
    ],
  },
  codex: {
    commands: ["codex"],
    markers: [
      path.join(home, ".codex", "config.toml"),
      path.join(home, ".codex"),
      localAppData ? path.join(localAppData, "OpenAI", "Codex") : null,
    ],
  },
  opencode: {
    commands: ["opencode"],
    markers: [
      path.join(home, ".config", "opencode", "opencode.json"),
      path.join(home, ".config", "opencode"),
      path.join(home, ".opencode"),
      path.join(home, ".local", "share", "opencode"),
      appData ? path.join(appData, "ai.opencode.desktop") : null,
    ],
  },
  openclaw: {
    commands: ["openclaw", "claw"],
    markers: [path.join(home, ".openclaw", "openclaw.json")],
  },
  hermes: {
    commands: ["hermes", "hermes-agent"],
    markers: [path.join(home, ".hermes", "config.yaml"), path.join(home, ".hermes")],
  },
};

console.log("extra bin dirs probed:");
for (const dir of getExtraBinDirs()) console.log("  -", dir);
console.log("");

for (const [tool, spec] of Object.entries(SPECS)) {
  const result = await detectCli(spec);
  console.log(
    tool.padEnd(10),
    String(result.installed).padEnd(6),
    (result.via || "-").padEnd(7),
    result.path || ""
  );
}
