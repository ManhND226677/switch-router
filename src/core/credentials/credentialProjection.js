const TOP_LEVEL_SECRET_FIELDS = [
  "apiKey",
  "accessToken",
  "refreshToken",
  "idToken",
  "copilotToken",
  "clientSecret",
];

const PROVIDER_DATA_SECRET_PATTERN = /(?:api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|copilot[-_]?token|client[-_]?secret|cookie|password|authorization|session[-_]?token)/i;

function copyProviderSpecificData(providerSpecificData = {}) {
  if (!providerSpecificData || typeof providerSpecificData !== "object") return {};
  return Object.fromEntries(
    Object.entries(providerSpecificData).filter(([key]) => !PROVIDER_DATA_SECRET_PATTERN.test(key)),
  );
}

/**
 * Build the runtime credential shape consumed by executors. Secrets stay in
 * this server-side projection and are never exposed by the redaction helper.
 */
export function buildRuntimeCredentials(connection, resolvedProxy = {}) {
  if (!connection) return null;

  const providerSpecificData = {
    ...(connection.providerSpecificData || {}),
    connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
    connectionProxyUrl: resolvedProxy.connectionProxyUrl,
    connectionNoProxy: resolvedProxy.connectionNoProxy,
    connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
  };

  return {
    authType: connection.authType,
    apiKey: connection.apiKey,
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    idToken: connection.idToken,
    expiresAt: connection.expiresAt,
    expiresIn: connection.expiresIn,
    lastRefreshAt: connection.lastRefreshAt,
    projectId: connection.projectId,
    connectionName: connection.displayName || connection.name || connection.email || connection.id,
    copilotToken: connection.providerSpecificData?.copilotToken,
    providerSpecificData,
    connectionId: connection.id,
    testStatus: connection.testStatus,
    lastError: connection.lastError,
    _connection: connection,
  };
}

/**
 * Return a connection safe for dashboard/API responses. This intentionally
 * removes both known top-level secrets and secret-looking provider metadata.
 */
export function redactProviderConnection(connection) {
  if (!connection) return null;

  const safe = { ...connection };
  for (const field of TOP_LEVEL_SECRET_FIELDS) delete safe[field];
  delete safe._connection;
  safe.providerSpecificData = copyProviderSpecificData(connection.providerSpecificData);
  return safe;
}

export { PROVIDER_DATA_SECRET_PATTERN };
