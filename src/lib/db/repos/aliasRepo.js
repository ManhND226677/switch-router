import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { makeKv } from "../helpers/kvStore.js";

const aliasKv = makeKv("modelAliases");
const customKv = makeKv("customModels");

// Hot-path cache for model alias map (chat alias resolution).
if (!global._modelAliasesCache) global._modelAliasesCache = { at: 0, value: null, inflight: null };
const aliasesCache = global._modelAliasesCache;
const ALIASES_CACHE_TTL_MS = 5000;

export function invalidateModelAliasesCache() {
  aliasesCache.at = 0;
  aliasesCache.value = null;
  aliasesCache.inflight = null;
}

// modelAliases: key=alias, value=modelString
export async function getModelAliases() {
  const now = Date.now();
  if (aliasesCache.value && now - aliasesCache.at < ALIASES_CACHE_TTL_MS) {
    return { ...aliasesCache.value };
  }
  if (aliasesCache.inflight) {
    const v = await aliasesCache.inflight;
    return { ...v };
  }

  aliasesCache.inflight = aliasKv.getAll()
    .then((all) => {
      aliasesCache.value = all || {};
      aliasesCache.at = Date.now();
      aliasesCache.inflight = null;
      return aliasesCache.value;
    })
    .catch((err) => {
      aliasesCache.inflight = null;
      throw err;
    });

  const v = await aliasesCache.inflight;
  return { ...v };
}

export async function setModelAlias(alias, model) {
  await aliasKv.set(alias, model);
  invalidateModelAliasesCache();
}

export async function deleteModelAlias(alias) {
  await aliasKv.remove(alias);
  invalidateModelAliasesCache();
}

// customModels: key=`${providerAlias}|${id}|${type}`, value=full model object
function customKey(providerAlias, id, type) {
  return `${providerAlias}|${id}|${type}`;
}

export async function getCustomModels() {
  const all = await customKv.getAll();
  return Object.values(all);
}

// Atomic check-then-insert inside transaction to prevent duplicate races
export async function addCustomModel({ providerAlias, id, type = "llm", name }) {
  const k = customKey(providerAlias, id, type);
  const db = await getAdapter();
  let added = false;
  db.transaction(() => {
    const row = db.get(`SELECT 1 FROM kv WHERE scope = 'customModels' AND key = ?`, [k]);
    if (row) return;
    const value = stringifyJson({ providerAlias, id, type, name: name || id });
    db.run(`INSERT INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, value]);
    added = true;
  });
  return added;
}

export async function deleteCustomModel({ providerAlias, id, type = "llm" }) {
  await customKv.remove(customKey(providerAlias, id, type));
}
