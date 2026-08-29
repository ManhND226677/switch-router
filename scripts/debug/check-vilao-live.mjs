// Live end-to-end check of the ViLao provider against the real gateway.
// Reads the key from VILAO_API_KEY — never prints it.
// Usage: VILAO_API_KEY=sk-... node scripts/check-vilao-live.mjs
import { normalizeVilaoBaseUrl } from "../open-sse/providers/vilao.js";

const key = process.env.VILAO_API_KEY;
if (!key) { console.error("VILAO_API_KEY is not set"); process.exit(2); }

const base = normalizeVilaoBaseUrl(process.env.VILAO_BASE_URL);
const redact = (s) => String(s).replaceAll(key, "sk-***REDACTED***");
const auth = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

console.log(`base URL: ${base}\n`);

const call = async (method, path, body) => {
  try {
    const res = await fetch(base + path, {
      method,
      headers: auth,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(90000),
    });
    return { status: res.status, text: await res.text(), res };
  } catch (err) {
    return { status: 0, text: `${err.name}: ${err.message}` };
  }
};

// ── 1. GET /v1/models — the catalog the dashboard resolver reads ────────────
const models = await call("GET", "/models");
console.log(`GET  /models              ${models.status}`);
let modelIds = [];
if (models.status === 200) {
  const data = JSON.parse(models.text);
  modelIds = (data?.data || []).map((m) => m.id);
  console.log(`     ${modelIds.length} model(s): ${modelIds.slice(0, 15).join(", ")}${modelIds.length > 15 ? " …" : ""}`);
  const sample = (data?.data || [])[0];
  if (sample) console.log(`     sample entry: ${JSON.stringify(sample)}`);
} else {
  console.log(`     ${redact(models.text).slice(0, 300)}`);
}

const pick = modelIds[0];

// ── 2. POST /v1/chat/completions — non-streaming ────────────────────────────
if (pick) {
  const chat = await call("POST", "/chat/completions", {
    model: pick,
    messages: [{ role: "user", content: "Reply with exactly: OK" }],
    max_tokens: 16,
  });
  console.log(`\nPOST /chat/completions    ${chat.status}  (model: ${pick})`);
  if (chat.status === 200) {
    const d = JSON.parse(chat.text);
    console.log(`     content: ${JSON.stringify(d?.choices?.[0]?.message?.content)}`);
    console.log(`     usage:   ${JSON.stringify(d?.usage)}`);
    console.log(`     finish:  ${d?.choices?.[0]?.finish_reason}`);
  } else {
    console.log(`     ${redact(chat.text).slice(0, 300)}`);
  }

  // ── 3. streaming ─────────────────────────────────────────────────────────
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ model: pick, messages: [{ role: "user", content: "Count: 1 2 3" }], max_tokens: 32, stream: true }),
      signal: AbortSignal.timeout(90000),
    });
    console.log(`\nPOST /chat/completions    ${res.status}  (stream:true) content-type=${res.headers.get("content-type")}`);
    if (res.ok) {
      const raw = await res.text();
      const lines = raw.split("\n").filter((l) => l.startsWith("data:"));
      const done = lines.some((l) => l.includes("[DONE]"));
      let text = "";
      for (const l of lines) {
        if (l.includes("[DONE]")) continue;
        try { text += JSON.parse(l.slice(5))?.choices?.[0]?.delta?.content || ""; } catch { /* skip */ }
      }
      console.log(`     ${lines.length} SSE data line(s), [DONE]=${done}, assembled: ${JSON.stringify(text.slice(0, 80))}`);
    }
  } catch (err) {
    console.log(`\nPOST /chat/completions    stream ERR ${err.name}: ${err.message}`);
  }
}

// ── 4. Which endpoints ACTUALLY exist (auth no longer masks routing) ────────
console.log("\nendpoint existence with a VALID key:");
const probes = [
  ["POST", "/embeddings", { model: "text-embedding-3-small", input: "xin chào" }],
  ["POST", "/completions", { model: pick || "gpt-4o", prompt: "hi", max_tokens: 8 }],
  ["POST", "/messages", { model: pick || "gpt-4o", max_tokens: 16, messages: [{ role: "user", content: "hi" }] }],
  ["POST", "/responses", { model: pick || "gpt-4o", input: "hi" }],
  ["POST", "/images/generations", { model: "dall-e-3", prompt: "a cat", n: 1 }],
  ["POST", "/audio/speech", { model: "tts-1", input: "hi", voice: "alloy" }],
];
for (const [method, path, body] of probes) {
  const r = await call(method, path, body);
  console.log(`  ${method} ${path.padEnd(22)} ${String(r.status).padEnd(4)} ${redact(r.text).replace(/\s+/g, " ").slice(0, 150)}`);
}
