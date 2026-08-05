// The provider notice/link is rendered client-side, so the referral URL lives in a
// JS chunk rather than the server HTML. Fetch the page, follow its script tags, and
// confirm the referral link is what the browser actually receives.
// Usage: node scripts/check-vilao-ref-served.mjs [port]
const port = process.argv[2] || "28701";
const base = `http://127.0.0.1:${port}`;
const REF = "REF2fXFGBsf";
const STALE = /vilao\.ai\\?\/(console|docs)/;

const page = await fetch(`${base}/dashboard/providers/new`, { signal: AbortSignal.timeout(45000) }).then((r) => r.text());
const scripts = [...new Set([...page.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]))];
console.log(`page: ${page.length}B, ${scripts.length} script chunk(s)\n`);

let refHits = [];
let staleHits = [];
for (const src of scripts) {
  const js = await fetch(base + src, { signal: AbortSignal.timeout(45000) }).then((r) => r.text()).catch(() => "");
  if (js.includes(REF)) refHits.push(src);
  if (STALE.test(js)) staleHits.push(src);
}

// The chunk holding the provider catalog may be lazy-loaded; scan every built chunk
// as a fallback so a negative result is trustworthy.
if (refHits.length === 0) {
  const fs = await import("node:fs/promises");
  const dir = ".next/static/chunks";
  const walk = async (d) => {
    const out = [];
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) out.push(...(await walk(p)));
      else if (e.name.endsWith(".js")) out.push(p);
    }
    return out;
  };
  const files = await walk(dir).catch(() => []);
  console.log(`page scripts had no hit — scanning all ${files.length} built chunk(s)`);
  for (const f of files) {
    const js = await fs.readFile(f, "utf8").catch(() => "");
    if (js.includes(REF)) refHits.push(f);
    if (STALE.test(js)) staleHits.push(f);
  }
}

console.log(`referral link found in ${refHits.length} chunk(s):`);
refHits.slice(0, 5).forEach((s) => console.log("  + " + s));
console.log(`stale console/docs vilao.ai link in ${staleHits.length} chunk(s):`);
staleHits.slice(0, 5).forEach((s) => console.log("  - " + s));

const ok = refHits.length > 0;
console.log(ok ? "\n✅ browser receives the referral link" : "\n❌ referral link not shipped to the browser");
process.exit(ok ? 0 : 1);
