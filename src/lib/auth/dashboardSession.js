// Dashboard authentication was removed for the local-only build.
// These compatibility exports intentionally never authenticate a caller. They
// remain temporarily so older imports fail closed while downstream cleanup lands.

export function clearDashboardAuthCookie(cookieStore) {
  cookieStore?.delete?.("auth_token");
}

export async function verifyDashboardAuthToken() {
  return false;
}

export async function getDashboardAuthSession() {
  return null;
}

export async function verifyDashboardPassword() {
  return false;
}
