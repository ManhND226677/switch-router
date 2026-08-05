function firstValue(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized) return normalized;
  }
  return null;
}

export function resolveConnectionSelector(request, body = {}) {
  const url = new URL(request.url);
  const preferredConnectionId = firstValue(
    request.headers.get("x-connection-id"),
    url.searchParams.get("connection_id"),
    body?.connection_id,
  );
  const providerHint = firstValue(
    request.headers.get("x-provider"),
    url.searchParams.get("provider"),
    body?.provider,
  );
  return { preferredConnectionId, providerHint };
}

export function modelForProvider(model, providerHint) {
  if (typeof model !== "string" || !model.trim() || !providerHint) return model;
  return model.includes("/") ? model : `${providerHint}/${model}`;
}

export { firstValue };
