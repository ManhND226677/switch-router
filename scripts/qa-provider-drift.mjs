// Provider drift detector.
//
// Why this exists: in v0.5.0 six providers were deleted from the registry, but
// tests, snapshots and baseline fixtures kept referencing them. The result was
// 12 obsolete snapshots and a real pass->fail regression that nobody noticed,
// because there was no automated check tying test fixtures back to the registry.
//
// This script compares the canonical PROVIDERS registry against every provider
// id referenced by test fixtures, and fails when a test references a provider
// that no longer exists.
//
// Usage: node scripts/qa-provider-drift.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { PROVIDERS } from "../open-sse/config/providers.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const testsDir = join(root, "tests");

const known = new Set(Object.keys(PROVIDERS));

/** Recursively collect test-owned files worth scanning. */
function collect(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collect(full, out);
    } else if (/\.(test\.js|snap|json)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// Baseline fixtures legitimately snapshot the *old* registry shape, so a
// removed provider there is expected until the baseline is re-snapshotted.
// Generated Vitest reports (gitignored) are machine output, not hand-written
// test sources, so they must never be treated as orphaned references.
const EXEMPT = [/__baseline__[\\/]/, /[\\/]\.vitest-reports?[\\/]/];

const files = collect(testsDir).filter((f) => !EXEMPT.some((re) => re.test(f)));

// Providers known to have been retired. Extend this list whenever a provider
// is removed from the registry.
const REMOVED_LIST = [
  "cerebras",
  "blackbox",
  "azure",
  "cavoti",
  "kiro",
  "mimo-free",
  "mmf",
  "assemblyai",
  "aws-polly",
  "black-forest-labs",
  "brave-search",
  "cartesia",
  "comfyui",
  "coqui",
  "deepgram",
  "edge-tts",
  "elevenlabs",
  "exa",
  "fal-ai",
  "firecrawl",
  "google-pse",
  "google-tts",
  "huggingface",
  "inworld",
  "jina-ai",
  "jina-reader",
  "linkup",
  "local-device",
  "nanobanana",
  "perplexity-web",
  "playht",
  "recraft",
  "runwayml",
  "sdwebui",
  "searchapi",
  "searxng",
  "serper",
  "stability-ai",
  "tavily",
  "topaz",
  "tortoise",
  "voyage-ai",
  "youcom",
];
// Only treat as removed if genuinely absent from the registry today.
const REMOVED = new Set(REMOVED_LIST.filter((id) => !known.has(id)));

// Match provider ids only where they are used as an identifier-like string,
// e.g. "siliconflow" or 'nvidia' — avoids matching prose in comments.
const findings = new Map();

for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const quoted = text.matchAll(/["']([a-z0-9][a-z0-9._-]{2,40})["']/g);
  for (const m of quoted) {
    const id = m[1];
    // Only care about ids that look like providers we used to ship.
    if (known.has(id)) continue;
    if (!/^[a-z0-9-]+$/.test(id)) continue;
    // Heuristic: flag only ids that appear in the removed-provider list.
    if (!REMOVED.has(id)) continue;
    const rel = relative(root, file).split("\\").join("/");
    if (!findings.has(id)) findings.set(id, new Set());
    findings.get(id).add(rel);
  }
}

// Providers known to have been removed. Extend this list whenever a provider
// is retired, or regenerate from git history.
if (findings.size === 0) {
  console.log(`OK — no orphaned provider references. (${known.size} providers in registry)`);
  process.exit(0);
}

console.error("\nProvider drift detected — tests reference providers that no longer exist:\n");
let total = 0;
for (const [id, fileSet] of [...findings].sort()) {
  console.error(`  ${id}  (${fileSet.size} file(s))`);
  for (const f of [...fileSet].sort()) {
    console.error(`      ${f}`);
    total++;
  }
}
console.error(
  `\n${findings.size} removed provider(s) still referenced across ${total} file entries.`,
);
console.error("Fix: delete the orphaned cases, or re-snapshot with `vitest run -u`.\n");
process.exit(1);
