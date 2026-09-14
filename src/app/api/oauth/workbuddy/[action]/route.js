import { NextResponse } from "next/server";
import { createProviderConnection, getProviderConnections, updateProviderConnection } from "@/lib/localDb";
import { resolveWorkbuddySession } from "open-sse/executors/workbuddy.js";

// WorkBuddy AI login mirrors the desktop app's external-link flow:
//   1. POST /v2/plugin/auth/state?platform=workbuddy-ai  -> { state, authUrl }
//   2. user signs in on authUrl (the real WorkBuddy login page)
//   3. GET  /v2/plugin/auth/token?state=<state>          -> authToken once login completes
// Pending polls answer code 11217 ("login ing..."), same as the app.
const WB_BASE = "https://www.workbuddy.ai";
const NO_CREDENTIAL_HEADERS = {
  "X-No-Authorization": "true",
  "X-No-User-Id": "true",
  "X-No-Enterprise-Id": "true",
  "X-No-Department-Info": "true",
};
const FLOW_TTL_MS = 5 * 60 * 1000;
// state -> { at, mode: "app" | "web" }. "app" imports the desktop app session;
// "web" polls the real WorkBuddy login even when the app session exists, so a
// second account can be added alongside the first.
const flows = new Map();

function decodeJwtSubject(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

// Best-effort account identity so connections are named after the real account
// (email/name from the Keycloak userinfo endpoint) instead of a generic
// "browser login"/"app session" label. Never throws — a failed lookup only
// downgrades the connection name.
async function fetchAccountLabel(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch(`${WB_BASE}/auth/realms/copilot/protocol/openid-connect/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const info = await res.json().catch(() => null);
    return info?.email || info?.name || info?.preferred_username || null;
  } catch {
    return null;
  }
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

export async function GET(request, { params }) {
  try {
    const { action } = await params;
    if (action === "authorize") {
      // Legacy dashboard bundle (authorization-code path). The WorkBuddy flow is
      // device-code style and lives in the refreshed client code.
      return NextResponse.json(
        { error: "Dashboard bundle outdated for WorkBuddy OAuth — hard-refresh the page (Ctrl+Shift+R) and press the OAuth button again." },
        { status: 400 },
      );
    }
    if (action !== "device-code") {
      return NextResponse.json({ error: "Unknown action" }, { status: 404 });
    }

    // Fast path: this host already runs a logged-in WorkBuddy desktop app.
    // No verification_uri is returned on purpose — the modal then opens no
    // browser tab and the poll completes straight from the app session.
    // `?mode=web` skips the fast path so the user can log in as a different
    // account and get a second connection.
    const mode = request.nextUrl?.searchParams?.get("mode") === "web" ? "web" : "app";
    if (mode === "app" && resolveWorkbuddySession({})) {
      const localCode = crypto.randomUUID();
      flows.set(localCode, { at: Date.now(), mode });
      return NextResponse.json({
        device_code: localCode,
        interval: 1,
        expires_in: Math.round(FLOW_TTL_MS / 1000),
      });
    }

    const res = await fetch(`${WB_BASE}/v2/plugin/auth/state?platform=workbuddy-ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...NO_CREDENTIAL_HEADERS },
      body: "{}",
    });
    const json = await res.json().catch(() => null);
    const state = json?.data?.state;
    const authUrl = json?.data?.authUrl;
    if (!res.ok || json?.code !== 0 || !state || !authUrl) {
      return NextResponse.json({ error: json?.msg || "WorkBuddy login state request failed" }, { status: 502 });
    }

    flows.set(state, { at: Date.now(), mode });
    return NextResponse.json({
      device_code: state,
      verification_uri: authUrl,
      verification_uri_complete: authUrl,
      interval: 2,
      expires_in: Math.round(FLOW_TTL_MS / 1000),
    });
  } catch (error) {
    console.error("OAuth workbuddy GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const { action } = await params;
    if (action !== "poll") {
      return NextResponse.json({ error: "Unknown action" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const state = body.deviceCode;
    const flow = flows.get(state);
    const startedAt = typeof flow === "number" ? flow : flow?.at;
    const flowMode = typeof flow === "object" && flow ? flow.mode : "app";
    if (!startedAt) {
      return NextResponse.json({ success: false, error: "expired_token", errorDescription: "Flow not found — restart the connection flow" });
    }
    if (Date.now() - startedAt > FLOW_TTL_MS) {
      flows.delete(state);
      return NextResponse.json({ success: false, error: "expired_token", errorDescription: "Authorization timeout" });
    }

    // Fast path: import the account already logged into the desktop app. Web
    // flows must never take it — the whole point of mode=web is a different
    // account than the one the app is signed into.
    const local = flowMode === "web" ? null : resolveWorkbuddySession({});
    if (local?.accessToken) {
      flows.delete(state);
      const label = (await fetchAccountLabel(local.accessToken)) || "app session";
      const connection = await upsertConnection({
        accessToken: null,
        uid: local.uid,
        nickname: label,
        email: looksLikeEmail(label) ? label : null,
      });
      return NextResponse.json({
        success: true,
        connection: { id: connection.id, provider: connection.provider },
      });
    }

    const res = await fetch(`${WB_BASE}/v2/plugin/auth/token?state=${encodeURIComponent(state)}`, {
      headers: NO_CREDENTIAL_HEADERS,
    });
    const json = await res.json().catch(() => null);
    const authToken = json?.data?.accessToken ? json.data : null;
    if (!authToken) {
      // 11217 = browser login not bound yet, keep polling
      return NextResponse.json({ success: false, error: "authorization_pending", pending: true });
    }
    flows.delete(state);

    const label = (await fetchAccountLabel(authToken.accessToken)) || authToken.nickname || "browser login";
    const connection = await upsertConnection({
      accessToken: authToken,
      uid: decodeJwtSubject(authToken.accessToken),
      nickname: label,
      email: looksLikeEmail(label) ? label : null,
    });

    return NextResponse.json({
      success: true,
      connection: { id: connection.id, provider: connection.provider },
    });
  } catch (error) {
    console.error("OAuth workbuddy POST error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// One WorkBuddy connection per account uid: logging into the same account
// again refreshes its existing connection, while a different uid (second
// WorkBuddy account) gets its own connection so accounts can coexist.
// The uid is the Keycloak `sub` claim; pasted-JWT connections may only carry
// it inside the token itself, so decode those too when matching.
function connectionUid(conn) {
  return conn?.providerSpecificData?.workbuddyUserId
    || decodeJwtSubject(conn?.apiKey)
    || decodeJwtSubject(conn?.accessToken)
    || null;
}

// Browser-login tokens are stored on the connection (self-refreshing); the
// desktop-session fallback stores apiKey "auto" so the executor always tracks
// the app's current token. `nickname` is the account label (email/name) used
// for the connection name; `email` also feeds the connection's email column.
async function upsertConnection({ accessToken, uid, nickname, email = null }) {
  if (!uid && accessToken?.accessToken) uid = decodeJwtSubject(accessToken.accessToken);
  const all = await getProviderConnections({ provider: "workbuddy" });
  const existing = uid
    ? all.find((conn) => connectionUid(conn) === uid)
    // No resolvable uid (token without `sub`): fall back to the first active
    // connection instead of piling up unidentifiable duplicates.
    : all.find((conn) => conn.isActive);

  const expiresAt = accessToken && (
    Number.isFinite(Number(accessToken.expiresAt)) && Number(accessToken.expiresAt) > 0
      ? new Date(Number(accessToken.expiresAt)).toISOString()
      : Number.isFinite(Number(accessToken.expiresIn)) && Number(accessToken.expiresIn) > 0
        ? new Date(Date.now() + Number(accessToken.expiresIn) * 1000).toISOString()
        : null
  ) || null;
  const accountName = nickname ? `WorkBuddy AI (${nickname})` : null;
  if (existing) {
    // Auto-generated names follow the account identity (e.g. the generic
    // "(app session)" pre-multi-account names); a user's custom rename stays.
    const isAutoName = /^WorkBuddy AI \([^)]*\)( · ..*)?$/.test(existing.name || "");
    await updateProviderConnection(existing.id, {
      ...(isAutoName && accountName && accountName !== existing.name ? { name: accountName } : {}),
      ...(accessToken ? {
        accessToken: accessToken.accessToken,
        refreshToken: accessToken.refreshToken || null,
        expiresIn: accessToken.expiresIn ?? null,
        expiresAt,
        apiKey: null,
      } : { apiKey: "auto" }),
      ...(email ? { email } : {}),
      testStatus: "active",
      lastError: null,
      providerSpecificData: {
        ...(existing.providerSpecificData || {}),
        workbuddyUserId: uid || connectionUid(existing) || null,
      },
    });
    return existing;
  }
  let name = accountName || `WorkBuddy AI (${String(uid || "account").slice(0, 8)})`;
  if (all.some((conn) => conn.name === name)) {
    name = `${name} · ${String(uid || crypto.randomUUID()).slice(0, 4)}`;
  }
  return createProviderConnection({
    provider: "workbuddy",
    authType: "oauth",
    name,
    ...(email ? { email } : {}),
    ...(accessToken ? {
      accessToken: accessToken.accessToken,
      refreshToken: accessToken.refreshToken || null,
      expiresIn: accessToken.expiresIn ?? null,
      expiresAt,
    } : { apiKey: "auto" }),
    providerSpecificData: { workbuddyUserId: uid || null },
    isActive: true,
    testStatus: "active",
  });
}
