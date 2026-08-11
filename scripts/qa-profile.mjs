// QA baseline profiler — analyzes a vitest JSON report to surface
// the slowest test files and where failures concentrate.
// Usage: node scripts/qa-profile.mjs <vitest-report.json>
import { readFileSync } from "node:fs";

const reportPath = process.argv[2];
if (!reportPath) {
  console.error("Usage: node scripts/qa-profile.mjs <vitest-report.json>");
  process.exit(2);
}

const r = JSON.parse(readFileSync(reportPath, "utf8"));

const files = (r.testResults || []).map((f) => {
  const norm = String(f.name || "").split("\\").join("/");
  const idx = norm.indexOf("tests/");
  const assertions = Array.isArray(f.assertionResults) ? f.assertionResults : [];
  return {
    name: idx >= 0 ? norm.slice(idx + 6) : norm,
    ms: (f.endTime ?? 0) - (f.startTime ?? 0),
    failed: assertions.filter((a) => a.status === "failed").length,
    total: assertions.length,
  };
});

files.sort((a, b) => b.ms - a.ms);
const totalMs = files.reduce((s, f) => s + f.ms, 0);

console.log(`Files: ${files.length}   Summed file time: ${(totalMs / 1000).toFixed(1)}s`);

console.log("\nTOP 12 SLOWEST FILES");
for (const f of files.slice(0, 12)) {
  console.log(
    `${(f.ms / 1000).toFixed(2).padStart(7)}s  ${String(f.total).padStart(4)} tests  ${f.name}`,
  );
}

const top10 = files.slice(0, 10).reduce((s, f) => s + f.ms, 0);
const top10Percent = totalMs > 0 ? ((top10 / totalMs) * 100).toFixed(1) : "0.0";
console.log(`\nTop 10 files = ${top10Percent}% of summed file time`);

console.log("\nFAILING FILES");
for (const f of files.filter((x) => x.failed > 0)) {
  console.log(`  ${f.failed}/${f.total} failed   ${f.name}`);
}
