// Prove a registry addition is purely ADDITIVE against the committed baselines:
// no existing provider, field, alias token, or model key may change.
// Usage: node scripts/verify-additive-registry.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PROVIDERS } from "../open-sse/config/providers.js";
import { PROVIDER_ID_TO_ALIAS, PROVIDER_MODELS } from "../open-sse/config/providerModels.js";
import { resolveProviderAlias } from "../open-sse/services/model.js";

const here = dirname(fileURLToPath(import.meta.url));
const baseDir = join(here, "..", "tests", "__baseline__");
const providersBase = JSON.parse(readFileSync(join(baseDir, "providers-baseline.json"), "utf8"));
const aliasBase = JSON.parse(readFileSync(join(baseDir, "alias-baseline.json"), "utf8"));

const problems = [];
const added = [];

// Fields the refactor intentionally added/removed — verify-providers.mjs drops these
// from BOTH sides because dedicated runtime tests cover them. Mirror that list so a
// pre-existing field delta is not misreported as a mutation caused by this change.
const ADDED_FIELDS = new Set(["forceStream", "urlSuffix", "retry", "quirks", "auth", "validateUrl", "usage", "clientId", "clientSecret", "tokenUrl", "cliVersion", "apiClient", "copilot", "authorizeUrl", "authUrl", "regions", "defaultRegion", "reasoningInject", "priority", "hasFree"]);

const strip = (entry) => {
  const copy = { ...entry };
  for (const f of ADDED_FIELDS) delete copy[f];
  return JSON.stringify(copy);
};

// 1. Every baseline provider must still exist and be byte-identical.
const current = JSON.parse(JSON.stringify(PROVIDERS));
for (const id of Object.keys(providersBase)) {
  if (!(id in current)) { problems.push(`provider REMOVED: ${id}`); continue; }
  if (strip(providersBase[id]) !== strip(current[id])) {
    problems.push(`provider MUTATED: ${id}`);
  }
}
for (const id of Object.keys(current)) if (!(id in providersBase)) added.push(`provider +${id}`);

// 2. Every baseline alias token must resolve to the same provider id.
for (const [token, expected] of Object.entries(aliasBase.aliasToId)) {
  const now = resolveProviderAlias(token);
  if (JSON.stringify(now) !== JSON.stringify(expected)) {
    problems.push(`alias MUTATED: ${token}: ${JSON.stringify(expected)} -> ${JSON.stringify(now)}`);
  }
}

// 3. Every baseline id→alias mapping must be unchanged.
for (const [id, alias] of Object.entries(aliasBase.idToAlias)) {
  if (PROVIDER_ID_TO_ALIAS[id] !== alias) {
    problems.push(`idToAlias MUTATED: ${id}: ${alias} -> ${PROVIDER_ID_TO_ALIAS[id]}`);
  }
}
for (const id of Object.keys(PROVIDER_ID_TO_ALIAS)) {
  if (!(id in aliasBase.idToAlias)) added.push(`idToAlias +${id} -> ${PROVIDER_ID_TO_ALIAS[id]}`);
}

// 4. Model keys may only be added.
for (const key of aliasBase.modelKeys) {
  if (!(key in PROVIDER_MODELS)) problems.push(`modelKey REMOVED: ${key}`);
}
for (const key of Object.keys(PROVIDER_MODELS)) {
  if (!aliasBase.modelKeys.includes(key)) added.push(`modelKey +${key}`);
}

// 5. No alias-token collision INTRODUCED by the new entries. Pre-existing
// collisions (e.g. providers sharing a display alias) are reported as notes.
const newIds = new Set(Object.keys(PROVIDER_ID_TO_ALIAS).filter((id) => !(id in aliasBase.idToAlias)));
const aliasCounts = new Map();
for (const [id, alias] of Object.entries(PROVIDER_ID_TO_ALIAS)) {
  if (!aliasCounts.has(alias)) aliasCounts.set(alias, []);
  aliasCounts.get(alias).push(id);
}
const preExisting = [];
for (const [alias, ids] of aliasCounts) {
  if (ids.length < 2) continue;
  const line = `alias "${alias}" claimed by ${ids.join(", ")}`;
  if (ids.some((id) => newIds.has(id))) problems.push(`alias COLLISION (new): ${line}`);
  else preExisting.push(line);
}

if (preExisting.length) {
  console.log(`\nPre-existing collisions (not caused by this change, ${preExisting.length}):`);
  preExisting.forEach((p) => console.log("  · " + p));
}

console.log(added.length ? `Additions (${added.length}):` : "No additions.");
added.forEach((a) => console.log("  + " + a));

if (problems.length) {
  console.error(`\n❌ NOT additive — ${problems.length} problem(s):`);
  problems.forEach((p) => console.error("  - " + p));
  process.exit(1);
}
console.log("\n✅ Purely additive: no existing provider, alias, or model key changed; no alias collision.");
