import { PROVIDERS } from "../../open-sse/config/providers.js";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ADDED_FIELDS = new Set(["forceStream", "urlSuffix", "retry", "quirks", "auth", "validateUrl", "usage", "clientId", "clientSecret", "tokenUrl", "cliVersion", "apiClient", "copilot", "authorizeUrl", "authUrl", "regions", "defaultRegion", "reasoningInject", "priority", "hasFree"]);

const out = {};
for (const [id, p] of Object.entries(PROVIDERS)) {
  const clean = JSON.parse(JSON.stringify(p));
  for (const f of ADDED_FIELDS) delete clean[f];
  out[id] = clean;
}

writeFileSync(join(here, "providers-baseline.json"), JSON.stringify(out, null, 2), "utf8");
console.log(`Snapshot providers-baseline.json (${Object.keys(out).length} providers)`);
