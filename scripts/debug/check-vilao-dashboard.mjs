// Check the running dashboard exposes the new ViLao provider through its own APIs.
// Usage: node scripts/check-vilao-dashboard.mjs [port]
const port = process.argv[2] || "28799";
const base = `http://127.0.0.1:${port}`;

const get = async (path) => {
  const res = await fetch(base + path, { signal: AbortSignal.timeout(60000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html or plain text */ }
  return { status: res.status, json, text };
};

// 1. Provider catalog served to the dashboard UI.
const cat = await get("/api/providers/catalog");
if (cat.json) {
  const flat = JSON.stringify(cat.json);
  console.log(`catalog        ${cat.status}  contains "vilao": ${flat.includes("\"vilao\"")}`);
  const name = flat.match(/"ViLao[^"]*"/);
  if (name) console.log(`               display name: ${name[0]}`);
} else {
  console.log(`catalog        ${cat.status}  (no JSON — ${cat.text.slice(0, 80).replace(/\s+/g, " ")})`);
}

// 2. Validation endpoint must recognise the provider id (an obviously bad key
//    should come back "not valid", NOT "unsupported provider").
const res = await fetch(`${base}/api/providers/validate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ provider: "vilao", apiKey: "sk-definitely-invalid-probe" }),
  signal: AbortSignal.timeout(60000),
});
const body = await res.text();
console.log(`validate       ${res.status}  ${body.slice(0, 200).replace(/\s+/g, " ")}`);

// 3. Prove the request reaches the dedicated `case "vilao"` and not a generic
//    fallback: a per-key endpoint override must be honoured. Pointing it at a
//    dead host has to surface a connection failure, not "Invalid API key".
const override = await fetch(`${base}/api/providers/validate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    provider: "vilao",
    apiKey: "sk-probe",
    providerSpecificData: { baseUrl: "https://vilao-endpoint-that-does-not-exist.invalid/v1" },
  }),
  signal: AbortSignal.timeout(60000),
});
const overrideBody = await override.text();
console.log(`override host  ${override.status}  ${overrideBody.slice(0, 200).replace(/\s+/g, " ")}`);
console.log("               (a network/fetch error here proves the override path is used)");
