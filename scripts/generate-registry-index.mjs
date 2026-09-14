// Regenerate open-sse/providers/registry/index.js — the auto-generated static
// import list of every registry entry.
//
// Why this exists: AGENTS.md says "regenerate it, don't hand-edit", but neither
// migrate-registry.mjs nor injectDisplayToRegistry.mjs writes index.js (both
// skip it via `f !== "index.js"`). This script is that missing generator.
//
// Ordering rule (matches the committed file): entries are listed alphabetically
// by filename, EXCEPT files added after the original generation, which were
// appended at the end. To keep diffs minimal and imports stable we preserve the
// existing order and append any new file, rather than re-sorting everything.
//
// Usage: node scripts/generate-registry-index.mjs [--check]

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY_DIR = join(HERE, "..", "open-sse", "providers", "registry");
const INDEX_PATH = join(REGISTRY_DIR, "index.js");
const CHECK_ONLY = process.argv.includes("--check");

const HEADER = "// Auto-generated: static imports for all registry entries";

// Files present on disk (REGISTRY_TEMPLATE lives outside registry/ by design).
const onDisk = readdirSync(REGISTRY_DIR)
  .filter((f) => f.endsWith(".js") && f !== "index.js")
  .sort();

// Preserve the order already committed in index.js, then append new files.
const current = readFileSync(INDEX_PATH, "utf8");
const existingOrder = [...current.matchAll(/^import\s+p\d+\s+from\s+"\.\/([^"]+)";$/gm)].map((m) => m[1]);

const known = new Set(existingOrder);
const stale = existingOrder.filter((f) => !onDisk.includes(f));
const added = onDisk.filter((f) => !known.has(f));
const ordered = [...existingOrder.filter((f) => onDisk.includes(f)), ...added];

const imports = ordered.map((file, i) => `import p${i} from "./${file}";`).join("\n");
const list = ordered.map((_, i) => `  p${i}`).join(",\n");
const output = `${HEADER}\n${imports}\n\nexport default [\n${list}\n];\n`;

if (CHECK_ONLY) {
  const same = current === output;
  console.log(same ? "✅ registry/index.js is up to date" : "❌ registry/index.js is STALE — run without --check");
  if (stale.length) console.log("   removed files still imported:", stale.join(", "));
  if (added.length) console.log("   files missing from index:", added.join(", "));
  process.exit(same ? 0 : 1);
}

writeFileSync(INDEX_PATH, output, "utf8");
console.log(`✅ registry/index.js regenerated — ${ordered.length} entries`);
if (added.length) console.log(`   added: ${added.join(", ")}`);
if (stale.length) console.log(`   dropped (file no longer exists): ${stale.join(", ")}`);
