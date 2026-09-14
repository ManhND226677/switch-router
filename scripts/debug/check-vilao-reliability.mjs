// Measure ViLao reliability: streaming vs non-streaming, N attempts each.
// Establishes whether the non-streaming path is genuinely flaky (justifying
// forceStream in the registry) or whether the earlier timeouts were noise.
// Reads the key from VILAO_API_KEY — never prints it.
import { normalizeVilaoBaseUrl } from "../open-sse/providers/vilao.js";

const key = process.env.VILAO_API_KEY;
if (!key) { console.error("VILAO_API_KEY is not set"); process.exit(2); }
const base = normalizeVilaoBaseUrl(process.env.VILAO_BASE_URL);
const model = process.env.VILAO_MODEL || "moonshotai/kimi-k3-free";
const N = Number(process.env.VILAO_N || 5);
const TIMEOUT = Number(process.env.VILAO_TIMEOUT_MS || 45000);
const auth = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

const attempt = async (stream) => {
  const t = Date.now();
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ model, messages: [{ role: "user", content: "Say OK" }], max_tokens: 300, stream }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    await res.text();
    return { ok: res.ok, ms: Date.now() - t, status: res.status };
  } catch (err) {
    return { ok: false, ms: Date.now() - t, status: err.name };
  }
};

const run = async (label, stream) => {
  const rows = [];
  for (let i = 0; i < N; i++) rows.push(await attempt(stream));
  const good = rows.filter((r) => r.ok);
  const times = good.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`${label.padEnd(12)} ok ${good.length}/${N}` +
    (times.length ? `  min=${times[0]}ms med=${times[Math.floor(times.length / 2)]}ms max=${times[times.length - 1]}ms` : "") +
    `\n             ${rows.map((r) => `${r.ok ? "✓" : "✗"}${r.status}/${r.ms}ms`).join("  ")}`);
  return good.length;
};

console.log(`model=${model}  attempts=${N}  timeout=${TIMEOUT}ms\n`);
const streamOk = await run("stream:true", true);
const jsonOk = await run("stream:false", false);

console.log(`\nverdict: streaming ${streamOk}/${N}, non-streaming ${jsonOk}/${N}` +
  (jsonOk < streamOk ? "  → non-streaming is less reliable; forceStream is justified" : "  → both comparable"));
