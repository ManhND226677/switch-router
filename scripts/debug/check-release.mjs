// Smoke-check the production build: key dashboard pages render and the new
// provider is present in the provider list the UI consumes.
// Usage: node scripts/check-release.mjs [port]
const port = process.argv[2] || "28701";
const base = `http://127.0.0.1:${port}`;

const pages = [
  "/api/health",
  "/dashboard",
  "/dashboard/cli-tools",
  "/dashboard/providers",
  "/dashboard/providers/new",
];

let bad = 0;
for (const p of pages) {
  try {
    const res = await fetch(base + p, { signal: AbortSignal.timeout(45000) });
    const body = await res.text();
    const ok = res.ok;
    if (!ok) bad++;
    console.log(`${String(res.status).padEnd(4)} ${p.padEnd(28)} ${body.length}B`);
  } catch (err) {
    bad++;
    console.log(`ERR  ${p.padEnd(28)} ${err.name}`);
  }
}

// The "add provider" page ships the provider catalog inline; confirm ViLao is there.
const addPage = await fetch(`${base}/dashboard/providers/new`, { signal: AbortSignal.timeout(45000) }).then((r) => r.text());
const hasVilao = /ViLao|"vilao"|\\"vilao\\"/.test(addPage);
console.log(`\nprovider picker contains ViLao: ${hasVilao}`);
if (!hasVilao) bad++;

// The referral link is rendered client-side, so it lives in a JS chunk rather than
// the server HTML. Follow the page's script tags and check what the browser gets.
const REF = "REF2fXFGBsf";
const scripts = [...new Set([...addPage.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]))];
let refChunks = 0;
let staleChunks = 0;
for (const src of scripts) {
  const js = await fetch(base + src, { signal: AbortSignal.timeout(45000) }).then((r) => r.text()).catch(() => "");
  if (js.includes(REF)) refChunks++;
  if (/vilao\.ai\\?\/(console|docs)/.test(js)) staleChunks++;
}
console.log(`referral link in served JS: ${refChunks > 0} (${refChunks}/${scripts.length} chunks)`);
console.log(`stale non-referral vilao.ai links: ${staleChunks}`);
if (refChunks === 0) bad++;
if (staleChunks > 0) bad++;

// Version actually served by the build.
const pkg = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync("package.json", "utf8")));
console.log(`package version: ${pkg.version}`);

console.log(bad ? `\n❌ ${bad} problem(s)` : "\n✅ Release smoke check passed");
process.exit(bad ? 1 : 0);
