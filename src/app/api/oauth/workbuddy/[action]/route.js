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
const flows = new Map();

function decodeJwtSubject(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
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
    if (resolveWorkbuddySession({})) {
      const localCode = crypto.randomUUID();
      flows.set(localCode, Date.now());
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

    flows.set(state, Date.now());
    return NextResponse.json({
      device_code: state,
      verification_uri: authUrl,
      verification_uri_complete: authUrl,
      interval: 2,
      expires_in: Math.round(FLOW_TTL_MS / 1000),
    });
  } catch (error) {
    console.log("OAuth workbuddy GET error:", error);
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
    const startedAt = flows.get(state);
    if (!startedAt) {
      return NextResponse.json({ success: false, error: "expired_token", errorDescription: "Flow not found — restart the connection flow" });
    }
    if (Date.now() - startedAt > FLOW_TTL_MS) {
      flows.delete(state);
      return NextResponse.json({ success: false, error: "expired_token", errorDescription: "Authorization timeout" });
    }

    // Fast path: import the account already logged into the desktop app.
    const local = resolveWorkbuddySession({});
    if (local?.accessToken) {
      flows.delete(state);
      const connection = await upsertConnection({
        accessToken: null,
        uid: local.uid,
        nickname: "app session",
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

    const connection = await upsertConnection({
      accessToken: authToken,
      uid: decodeJwtSubject(authToken.accessToken),
      nickname: authToken.nickname || "browser login",
    });

    return NextResponse.json({
      success: true,
      connection: { id: connection.id, provider: connection.provider },
    });
  } catch (error) {
    console.log("OAuth workbuddy POST error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Browser-login tokens are stored on the connection (self-refreshing); the
// desktop-session fallback stores apiKey "auto" so the executor always tracks
// the app's current token.
async function upsertConnection({ accessToken, uid, nickname }) {
  const expiresAt = accessToken && (
    Number.isFinite(Number(accessToken.expiresAt)) && Number(accessToken.expiresAt) > 0
      ? new Date(Number(accessToken.expiresAt)).toISOString()
      : Number.isFinite(Number(accessToken.expiresIn)) && Number(accessToken.expiresIn) > 0
        ? new Date(Date.now() + Number(accessToken.expiresIn) * 1000).toISOString()
        : null
  ) || null;
  const existing = (await getProviderConnections({ provider: "workbuddy", isActive: true }))[0];
  if (existing) {
    await updateProviderConnection(existing.id, {
      ...(accessToken ? {
        accessToken: accessToken.accessToken,
        refreshToken: accessToken.refreshToken || null,
        expiresIn: accessToken.expiresIn ?? null,
        expiresAt,
        apiKey: null,
      } : { apiKey: "auto" }),
      testStatus: "active",
      lastError: null,
      providerSpecificData: {
        ...(existing.providerSpecificData || {}),
        workbuddyUserId: uid || null,
      },
    });
    return existing;
  }
  return createProviderConnection({
    provider: "workbuddy",
    authType: "oauth",
    name: `WorkBuddy AI (${nickname})`,
    ...(accessToken ? {
      accessToken: accessToken.accessToken,
      refreshToken: accessToken.refreshToken || null,
      expiresIn: accessToken.expiresIn ?? null,
      expiresAt,
    } : { apiKey: "auto" }),
    priority: 1,
    providerSpecificData: { workbuddyUserId: uid || null },
    isActive: true,
    testStatus: "active",
  });
}
