// Windows-safe regression gate for the vitest suite.
//
// Why: tests/__baseline__/verify-no-regression.mjs keys each failure on
// `f.name.split("/app/")[1]`, a Linux-container path. On Windows the absolute
// path has no "/app/" segment, so every key becomes `undefined` and the gate
// reports every failure as a regression. This variant compares the set of
// FAILING TEST NAMES between two vitest JSON reports instead of relying on the
// file path shape, so it works anywhere.
//
// Usage: node scripts/compare-vitest-runs.mjs <baseline.json> <current.json>
import { readFileSync } from "node:fs";

const [basePath, curPath] = process.argv.slice(2);
if (!basePath || !curPath) {
  console.error("usage: node scripts/compare-vitest-runs.mjs <baseline.json> <current.json>");
  process.exit(2);
}

const failNames = (file) => {
  const r = JSON.parse(readFileSync(file, "utf8"));
  const set = new Set();
  for (const f of r.testResults || []) {
    for (const a of f.assertionResults || []) {
      if (a.status === "failed") set.add(a.fullName);
    }
  }
  return { set, total: r.numTotalTests, passed: r.numPassedTests, failed: r.numFailedTests };
};

const base = failNames(basePath);
const cur = failNames(curPath);

const newFails = [...cur.set].filter((n) => !base.set.has(n));
const fixed = [...base.set].filter((n) => !cur.set.has(n));

console.log(`baseline: ${base.passed} pass / ${base.failed} fail (of ${base.total})`);
console.log(`current : ${cur.passed} pass / ${cur.failed} fail (of ${cur.total})\n`);

if (fixed.length) {
  console.log(`Newly passing (${fixed.length}):`);
  fixed.forEach((n) => console.log("  + " + n));
  console.log("");
}

if (newFails.length) {
  console.error(`❌ REGRESSION — ${newFails.length} test(s) fail now but not in baseline:`);
  newFails.forEach((n) => console.error("  - " + n));
  process.exit(1);
}

console.log(`✅ No regression: every current failure (${cur.set.size}) is already failing in the baseline.`);
