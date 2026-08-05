// Full end-to-end test: register a ViLao connection in the local DB, then drive a
// real request THROUGH the Switch-Router gateway (/v1/chat/completions) so the
// whole chain is exercised — route → chat handler → chatCore → DefaultExecutor →
// api.vilao.ai → SSE → client format.
//
// Reads the key from VILAO_API_KEY, never prints it. Cleans up the connection it
// creates unless VILAO_KEEP=1.
//
// Usage: scripts\run-vilao.cmd scripts\check-vilao-gateway.mjs   (port via VILAO_PORT)

const key = process.env.VILAO_API_KEY;
if (!key) { console.error("VILAO_API_KEY is not set"); process.exit(2); }

const port = process.env.VILAO_PORT || "28799";
const gw = `http://127.0.0.1:${port}`;
const model = process.env.VILAO_MODEL || "moonshotai/kimi-k3-free";
const redact = (s) => String(s).replaceAll(key, "sk-***");

const j = async (path, init) => {
  const res = await fetch(gw + path, { ...init, signal: AbortSignal.timeout(120000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, res };
};

let created = null;
try {
  // 0. Grab a local gateway API key — /v1 requires one unless REQUIRE_API_KEY=false.
  const keysRes = await j("/api/keys");
  const keyList = keysRes.json?.keys || keysRes.json?.apiKeys || (Array.isArray(keysRes.json) ? keysRes.json : []);
  const gwKey = keyList.find((k) => (k.isActive ?? k.active) !== false)?.key
    || keyList[0]?.key || keyList[0]?.apiKey || null;
  console.log(`gateway key: ${gwKey ? `found (${gwKey.slice(0, 6)}…)` : "none — relying on REQUIRE_API_KEY=false"}`);
  const v1Headers = { "Content-Type": "application/json", ...(gwKey ? { Authorization: `Bearer ${gwKey}` } : {}) };

  // 1. Create the provider connection the gateway will route through.
  const create = await j("/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "vilao", apiKey: key, name: "ViLao E2E probe", testStatus: "active" }),
  });
  console.log(`POST /api/providers            ${create.status}`);
  if (create.status !== 200 && create.status !== 201) {
    console.log(`  ${redact(create.text).slice(0, 300)}`);
    process.exit(1);
  }
  created = create.json?.connection?.id || create.json?.id;
  console.log(`  connection id: ${created}`);

  // 2. Non-streaming through the gateway (exercises forceStream → SSE→JSON).
  const chat = await j("/v1/chat/completions", {
    method: "POST",
    headers: v1Headers,
    body: JSON.stringify({ model: `vilao/${model}`, messages: [{ role: "user", content: "Say OK" }], max_tokens: 300 }),
  });
  console.log(`\nPOST /v1/chat/completions      ${chat.status}  (non-stream, via gateway)`);
  if (chat.json) {
    console.log(`  content: ${JSON.stringify(chat.json?.choices?.[0]?.message?.content)}`);
    console.log(`  model:   ${chat.json?.model}   finish: ${chat.json?.choices?.[0]?.finish_reason}`);
    console.log(`  usage:   ${JSON.stringify(chat.json?.usage)}`);
  } else {
    console.log(`  ${redact(chat.text).replace(/\s+/g, " ").slice(0, 400)}`);
  }

  // 3. Streaming through the gateway. The ViLao upstream is intermittently slow,
  //    so retry a couple of times before calling it a failure.
  let streamOk = false;
  for (let attempt = 1; attempt <= 3 && !streamOk; attempt++) {
    try {
      const sres = await fetch(`${gw}/v1/chat/completions`, {
        method: "POST",
        headers: v1Headers,
        body: JSON.stringify({ model: `vilao/${model}`, messages: [{ role: "user", content: "Say OK" }], max_tokens: 300, stream: true }),
        signal: AbortSignal.timeout(120000),
      });
      const raw = await sres.text();
      const lines = raw.split("\n").filter((l) => l.startsWith("data:"));
      let content = "";
      for (const l of lines) {
        if (l.includes("[DONE]")) continue;
        try { content += JSON.parse(l.slice(5))?.choices?.[0]?.delta?.content || ""; } catch { /* skip */ }
      }
      console.log(`\nPOST /v1/chat/completions      ${sres.status}  (stream, attempt ${attempt}) ct=${sres.headers.get("content-type")}`);
      console.log(`  ${lines.length} SSE line(s), [DONE]=${raw.includes("[DONE]")}, content=${JSON.stringify(content.slice(0, 120))}`);
      if (!sres.ok) console.log(`  ${redact(raw).slice(0, 300)}`);
      streamOk = sres.ok && raw.includes("[DONE]");
    } catch (err) {
      console.log(`\nPOST /v1/chat/completions      stream attempt ${attempt} failed: ${err.name}`);
    }
  }
  if (!streamOk) console.log("  ⚠ streaming did not complete in 3 attempts (upstream flakiness)");

  // 4. Model catalog through the dashboard resolver.
  if (created) {
    const models = await j(`/api/providers/${created}/models`);
    const ids = (models.json?.models || []).map((m) => m.id || m);
    console.log(`\nGET  /api/providers/:id/models  ${models.status}  ${ids.length} model(s): ${ids.slice(0, 10).join(", ")}`);
  }
} finally {
  if (created && process.env.VILAO_KEEP !== "1") {
    const del = await fetch(`${gw}/api/providers/${created}`, { method: "DELETE", signal: AbortSignal.timeout(30000) }).catch(() => null);
    console.log(`\ncleanup: DELETE connection ${created} → ${del ? del.status : "failed"}`);
  }
}
