import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DefaultExecutor } from "./default.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { WORKBUDDY_IDENTITY_REWRITES } from "../config/appConstants.js";

// WorkBuddy AI (Tencent CodeBuddy) upstream quirks, measured 2026-08-28 against
// https://www.workbuddy.ai/v2/chat/completions:
//   1. Auth is `Authorization: Bearer <accessToken>` PLUS a required
//      `X-User-Id: <urlencoded uid>` header (product.json usernameHeader).
//   2. Non-stream requests are rejected (code 11101); registry sets forceStream.
//   3. Code 11128 "Illegal API invocation from an unapproved channel" (HTTP 400) is
//      upstream's client gate, not a prompt-shape error: measured 2026-08-30, every
//      payload whose system prompt opens with the Claude Code CLI identity line is
//      blocked (15/15) while every other payload passes (0/168), across all
//      connections and regardless of body size. transformRequest() below neutralizes
//      that one sentence.
//   4. A leading system message is still required, so transformRequest() prepends one
//      when the client sends none.
// The uid is the Keycloak `sub` claim of the accessToken JWT, so a pasted token
// is self-contained — no separate uid field is needed.

const AUTH_FILE_NAME = "workbuddy-desktop-ai.info";
const AUTH_RELATIVE = path.join("Data", "Public", "auth", AUTH_FILE_NAME);
const WORKBUDDY_API_BASE = "https://www.workbuddy.ai";

// The desktop app's shared auth file location varies by OS/product build. Probe
// the known candidates; first readable one wins. Overridable for testing.
function authFileCandidates() {
  if (process.env.WORKBUDDY_AUTH_FILE) return [process.env.WORKBUDDY_AUTH_FILE];
  const home = os.homedir();
  const candidates = [];
  // Windows: %LOCALAPPDATA%\<product>\Data\Public\auth\...
  if (process.env.LOCALAPPDATA) {
    for (const product of ["CodeBuddyExtension", "WorkBuddy AI", "WorkBuddyAI"]) {
      candidates.push(path.join(process.env.LOCALAPPDATA, product, AUTH_RELATIVE));
    }
  }
  // macOS / Linux equivalents
  candidates.push(
    path.join(home, "Library", "Application Support", "CodeBuddyExtension", AUTH_RELATIVE),
    path.join(home, ".config", "CodeBuddyExtension", AUTH_RELATIVE),
    path.join(home, ".codebuddy", AUTH_RELATIVE),
  );
  return candidates;
}

function decodeJwtSubject(token) {
  try {
    const parts = String(token).split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

// Best-effort read of the desktop app's shared session file. Returns
// { accessToken, uid } or null; never throws (a missing file is not fatal when
// the user pasted a token instead).
function readLocalSession() {
  for (const file of authFileCandidates()) {
    try {
      const doc = JSON.parse(fs.readFileSync(file, "utf8"));
      const accessToken = doc?.auth?.accessToken;
      const uid = doc?.account?.uid || decodeJwtSubject(accessToken);
      if (accessToken && uid) return { accessToken, uid };
    } catch {
      // not here / unreadable — try next candidate
    }
  }
  return null;
}

// Resolve { accessToken, uid }, or null when no credential exists anywhere.
// Priority: pasted apiKey > the connection's own stored token (kept fresh via
// refreshCredentials) > the desktop app's shared session file ("auto" mode).
// Shared with the connection-test harness and the OAuth import route.
export function resolveWorkbuddySession(credentials) {
  const overrideUid = credentials?.providerSpecificData?.workbuddyUserId;
  const pasted = typeof credentials?.apiKey === "string" ? credentials.apiKey.trim() : "";
  if (pasted && pasted !== "auto") {
    return { accessToken: pasted, uid: overrideUid || decodeJwtSubject(pasted) };
  }
  if (credentials?.accessToken) {
    return { accessToken: credentials.accessToken, uid: overrideUid || decodeJwtSubject(credentials.accessToken) };
  }
  const local = readLocalSession();
  if (local) {
    return { accessToken: local.accessToken, uid: overrideUid || local.uid };
  }
  return null;
}

function rewriteIdentityText(text) {
  let out = text;
  for (const { pattern, to } of WORKBUDDY_IDENTITY_REWRITES) out = out.replace(pattern, to);
  return out;
}

function rewriteIdentityContent(content) {
  if (typeof content === "string") return rewriteIdentityText(content);
  if (!Array.isArray(content)) return content;
  let changed = false;
  const next = content.map((part) => {
    if (part?.type !== "text" || typeof part.text !== "string") return part;
    const rewritten = rewriteIdentityText(part.text);
    if (rewritten === part.text) return part;
    changed = true;
    return { ...part, text: rewritten };
  });
  return changed ? next : content;
}

// Copies (never mutates) the system messages that carry a blocked client identity.
export function neutralizeChannelIdentity(messages) {
  let changed = false;
  const next = messages.map((msg) => {
    if (msg?.role !== "system") return msg;
    const content = rewriteIdentityContent(msg.content);
    if (content === msg.content) return msg;
    changed = true;
    return { ...msg, content };
  });
  return changed ? next : messages;
}

export class WorkbuddyExecutor extends DefaultExecutor {
  constructor() {
    super("workbuddy");
  }

  buildHeaders(credentials, stream = true) {
    const headers = super.buildHeaders(credentials, stream);
    const session = resolveWorkbuddySession(credentials);
    if (!session) {
      throw new Error(
        "WorkBuddy AI: no session — log into the WorkBuddy AI desktop app on this machine, or paste its accessToken JWT as the connection's API key."
      );
    }
    headers["Authorization"] = `Bearer ${session.accessToken}`;
    if (session.uid) headers["X-User-Id"] = encodeURIComponent(session.uid);
    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    if (!transformed || typeof transformed !== "object" || !Array.isArray(transformed.messages)) {
      return transformed;
    }
    // Registry forceStream coerces the effective stream flag to true even when
    // the client asked for a non-streaming response, but the body would still
    // carry the client's stream:false — upstream rejects that (code 11101).
    transformed.stream = stream;
    const messages = neutralizeChannelIdentity(transformed.messages);
    const first = messages[0];
    if (first?.role === "system") {
      return messages === transformed.messages ? transformed : { ...transformed, messages };
    }
    return {
      ...transformed,
      messages: [{ role: "system", content: "You are a helpful assistant." }, ...messages],
    };
  }

  // Same refresh call the desktop app makes: POST /v2/plugin/auth/token/refresh
  // with the current access token plus X-Refresh-Token. Lets browser-login
  // connections stay alive without the WorkBuddy app running.
  async refreshCredentials(credentials, log, proxyOptions = null) {
    const session = resolveWorkbuddySession(credentials);
    const refreshToken = credentials?.refreshToken;
    if (!session?.accessToken || !refreshToken) return null;
    try {
      const response = await proxyAwareFetch(`${WORKBUDDY_API_BASE}/v2/plugin/auth/token/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
          "X-Refresh-Token": refreshToken,
          "X-Auth-Refresh-Source": "plugin",
        },
        body: "{}",
      }, proxyOptions);
      if (!response.ok) return null;
      const json = await response.json().catch(() => null);
      const authToken = json?.data?.accessToken ? json.data : null;
      if (!authToken) return null;
      log?.info?.("TOKEN", "workbuddy refreshed");
      return {
        accessToken: authToken.accessToken,
        refreshToken: authToken.refreshToken || refreshToken,
        expiresIn: authToken.expiresIn,
      };
    } catch (error) {
      log?.error?.("TOKEN", `workbuddy refresh error: ${error.message}`);
      return null;
    }
  }
}

export default WorkbuddyExecutor;
