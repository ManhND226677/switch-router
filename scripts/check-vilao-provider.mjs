// End-to-end smoke check for the new ViLao provider registration:
// registry → PROVIDERS/PROVIDER_MODELS → executor selection → endpoint helper.
// Usage: node scripts/check-vilao-provider.mjs
import { PROVIDERS } from "../open-sse/config/providers.js";
import { PROVIDER_MODELS, isValidModel, PROVIDER_ID_TO_ALIAS } from "../open-sse/config/providerModels.js";
import REGISTRY from "../open-sse/providers/registry/index.js";
import { normalizeVilaoBaseUrl, getVilaoModelsUrl, VILAO_DEFAULT_BASE_URL } from "../open-sse/providers/vilao.js";

const fail = [];
const ok = (label, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  → ${detail}` : ""}`);
  if (!cond) fail.push(label);
};

const entry = REGISTRY.find((r) => r.id === "vilao");
ok("registry entry present", !!entry);
ok("category = apikey", entry?.category === "apikey", entry?.category);
ok("passthroughModels enabled", entry?.passthroughModels === true);

const p = PROVIDERS.vilao;
ok("PROVIDERS.vilao built", !!p);
ok("chat baseUrl", p?.baseUrl === "https://api.vilao.ai/v1/chat/completions", p?.baseUrl);
ok("format = openai", p?.format === "openai", p?.format);
ok("validateUrl", p?.validateUrl === "https://api.vilao.ai/v1/models", p?.validateUrl);

ok("alias maps to itself", PROVIDER_ID_TO_ALIAS.vilao === "vilao", PROVIDER_ID_TO_ALIAS.vilao);
// Passthrough aggregators intentionally omit `models` from the registry entry,
// so PROVIDER_MODELS has NO key for them — the catalog comes from modelsFetcher
// at runtime. Assert we match that shape.
ok(
  "no static model list (passthrough aggregator shape)",
  !("vilao" in PROVIDER_MODELS),
  `vilao in PROVIDER_MODELS = ${"vilao" in PROVIDER_MODELS}`
);

// passthrough: any user-defined marketplace alias must be accepted
const passthrough = new Set(REGISTRY.filter((r) => r.passthroughModels).map((r) => r.alias || r.id));
ok("arbitrary model id accepted (passthrough)", isValidModel("vilao", "my-custom-alias", passthrough));

// No dedicated executor: DefaultExecutor must handle it. Assert by absence from
// the executors map (importing executors/index.js here pulls in node-machine-id,
// a CJS module that only interops correctly under vitest).
const executorsSrc = await import("node:fs").then((fs) =>
  fs.readFileSync(new URL("../open-sse/executors/index.js", import.meta.url), "utf8")
);
ok("no custom executor registered (uses DefaultExecutor)", !/["']vilao["']\s*:/.test(executorsSrc));

// endpoint helper normalization
const cases = [
  [undefined, VILAO_DEFAULT_BASE_URL],
  ["", VILAO_DEFAULT_BASE_URL],
  ["https://api.vilao.ai/v1", "https://api.vilao.ai/v1"],
  ["https://api.vilao.ai/v1/", "https://api.vilao.ai/v1"],
  ["https://api.vilao.ai/v1/chat/completions", "https://api.vilao.ai/v1"],
  ["https://gw.example.com", "https://gw.example.com/v1"],
  ["gw.example.com/v1", "https://gw.example.com/v1"],
  ["not a url ::::", VILAO_DEFAULT_BASE_URL],
];
for (const [input, expected] of cases) {
  const got = normalizeVilaoBaseUrl(input);
  ok(`normalize ${JSON.stringify(input)}`, got === expected, got);
}
ok("models url default", getVilaoModelsUrl() === "https://api.vilao.ai/v1/models", getVilaoModelsUrl());

console.log(fail.length ? `\n❌ ${fail.length} check(s) failed` : "\n✅ All ViLao provider checks passed");
process.exit(fail.length ? 1 : 0);
