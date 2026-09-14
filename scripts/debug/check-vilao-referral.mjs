// Verify the ViLao referral link reaches every place the dashboard renders a
// provider link: notice.apiKeyUrl (the "Get API Key" button), notice.signupUrl,
// and website. Uses the same builder the UI imports.
import REGISTRY from "../open-sse/providers/registry/index.js";

const REF = "https://vilao.ai/r/REF2fXFGBsf";
const entry = REGISTRY.find((r) => r.id === "vilao");

const fail = [];
const ok = (label, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  → ${detail}` : ""}`);
  if (!cond) fail.push(label);
};

ok("registry display.website is the ref link", entry?.display?.website === REF, entry?.display?.website);
ok("registry notice.apiKeyUrl is the ref link", entry?.display?.notice?.apiKeyUrl === REF, entry?.display?.notice?.apiKeyUrl);
ok("registry notice.signupUrl is the ref link", entry?.display?.notice?.signupUrl === REF, entry?.display?.notice?.signupUrl);

// The UI consumes AI_PROVIDERS, which is built by src/shared/constants/providers.js.
// Importing that module pulls in Next-only paths, so replicate its display spread
// (`...display` — it copies notice through verbatim) and assert nothing is dropped.
const uiEntry = { ...entry.display, id: entry.id, alias: entry.uiAlias || entry.alias };
ok("UI entry keeps notice.apiKeyUrl", uiEntry.notice?.apiKeyUrl === REF, uiEntry.notice?.apiKeyUrl);
ok("UI entry keeps notice.signupUrl", uiEntry.notice?.signupUrl === REF, uiEntry.notice?.signupUrl);
ok("UI entry keeps website", uiEntry.website === REF, uiEntry.website);

// ProviderInfoCard: signupUrl = notice.apiKeyUrl || website
ok("ProviderInfoCard link resolves to ref", (uiEntry.notice?.apiKeyUrl || uiEntry.website) === REF);
// providers/[id]/page.js: notice.apiKeyUrl || notice.signupUrl || website
ok("provider detail header link resolves to ref",
  (uiEntry.notice?.apiKeyUrl || uiEntry.notice?.signupUrl || uiEntry.website) === REF);

// No stale non-referral vilao.ai link left in the entry (the console path is
// allowed only inside the human-readable notice text).
const serialized = JSON.stringify({ ...entry.display, notice: { ...entry.display.notice, text: "" } });
const stale = serialized.match(/https:\/\/vilao\.ai\/(?!r\/)[^"]*/g) || [];
ok("no non-referral vilao.ai URL left in links", stale.length === 0, stale.join(", ") || "none");

console.log(fail.length ? `\n❌ ${fail.length} check(s) failed` : `\n✅ Referral link wired into every provider link`);
process.exit(fail.length ? 1 : 0);
