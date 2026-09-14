let modelNameCache = null;

export async function fetchModelNames() {
  if (modelNameCache) return modelNameCache;

  try {
    const res = await fetch("/api/models");
    const data = await res.json();
    const map = {};
    for (const m of data.models || []) {
      // m.model is the id, m.alias is user alias, m.name is original name
      const displayName = m.alias !== m.model ? m.alias : (m.name || m.model);
      map[m.model] = displayName;
      map[m.fullModel] = displayName;
    }
    modelNameCache = map;
  } catch (error) {
    console.error("Failed to fetch model names:", error);
    modelNameCache = {};
  }
  
  return modelNameCache;
}

export function getModelName(modelId, cache) {
  if (!modelId) return modelId;
  if (!cache) return modelId;
  return cache[modelId] || modelId;
}
