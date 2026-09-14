/**
 * Local micro-bench for hot-path DB/auth costs (no upstream).
 * Metric: avg ms / call — lower is better.
 *
 *   node --import ./scripts/alias-register.mjs scripts/bench-hotpath-local.mjs
 */
import { performance } from "node:perf_hooks";

const N = Number(process.env.BENCH_N || 100);

async function timeAvg(label, fn, n = N) {
  // warmup
  for (let i = 0; i < Math.min(5, n); i++) await fn();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) await fn();
  const total = performance.now() - t0;
  return { label, n, totalMs: +total.toFixed(2), avgMs: +(total / n).toFixed(4) };
}

const { getSettings } = await import("../src/lib/db/repos/settingsRepo.js");
const { getProviderConnections } = await import("../src/lib/db/repos/connectionsRepo.js");

const results = [];
results.push(await timeAvg("getSettings", () => getSettings()));

const connections = await getProviderConnections({ isActive: true });
const providers = [...new Set(connections.map((c) => c.provider))].slice(0, 3);
if (providers.length === 0) {
  results.push({ label: "getProviderConnections(provider)", n: 0, totalMs: 0, avgMs: null, note: "no active connections" });
} else {
  const provider = providers[0];
  results.push(await timeAvg(`getProviderConnections(${provider})`, () => getProviderConnections({ provider, isActive: true })));
}

// Concurrent getSettings pressure (cache win shows here)
{
  const t0 = performance.now();
  await Promise.all(Array.from({ length: N }, () => getSettings()));
  const total = performance.now() - t0;
  results.push({ label: `getSettings x${N} parallel`, n: N, totalMs: +total.toFixed(2), avgMs: +(total / N).toFixed(4) });
}

console.log(JSON.stringify({ metric: "hotpath_local_avg_ms", lower_is_better: true, results }, null, 2));
