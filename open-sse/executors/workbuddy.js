import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DefaultExecutor } from "./default.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import {
  WORKBUDDY_CHAT_USER_AGENT,
  WORKBUDDY_IDENTITY_REWRITES,
} from "../config/appConstants.js";

// WorkBuddy AI (Tencent CodeBuddy) upstream quirks, measured 2026-08-28 against
// https://www.workbuddy.ai/v2/chat/completions:
//   1. Auth is `Authorization: Bearer <accessToken>` PLUS a required
//      `X-User-Id: <urlencoded uid>` header (product.json usernameHeader).
//      The chat plane also accepts the native CLI CodeBuddy User-Agent; sending it
//      prevents an upstream channel policy from treating the gateway as a foreign
//      harness. Enterprise/tenant headers are added when the JWT discloses them.
//   2. Non-stream requests are rejected (code 11101); registry sets forceStream.
//   3. Code 11128 "Illegal API invocation from an unapproved channel" (HTTP 400) is
//      upstream's client gate, so the final request must use a WorkBuddy-compatible
//      harness. `normalizeWorkbuddyHarness()` is the last body transformation after
//      translation and token savers: it removes foreign client markers, strips
//      client-only metadata, and keeps the supported OpenAI chat wire shape.
//   4. A leading system message is still required, so the normalizer prepends one
//      when the client sends none.
//   5. `reasoning_effort` is validated against the routed model: an unrecognised
//      value fails the request (400 code 11150 invalid_reasoning_effort), so the
//      normalizer drops the field rather than forwarding a client guess.
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

function decodeJwtClaims(token) {
  try {
    const parts = String(token).split(".");
    if (parts.length < 2) return null;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function decodeJwtIdentity(token) {
  const claims = decodeJwtClaims(token);
  if (!claims || typeof claims !== "object") return {};
  return {
    uid: claims.user_id || claims.userId || claims.uid || claims.sub || null,
    tenantId: claims.tenant_id || claims.tenantId || null,
    enterpriseId: claims.enterprise_id || claims.enterpriseId || claims.ent_id || claims.entId || null,
  };
}

function decodeJwtSubject(token) {
  const uid = decodeJwtIdentity(token).uid;
  return typeof uid === "string" ? uid : null;
}

// Best-effort read of the desktop app's shared session file. Returns
// { accessToken, uid } or null; never throws (a missing file is not fatal when
// the user pasted a token instead).
function readLocalSession() {
  for (const file of authFileCandidates()) {
    try {
      const doc = JSON.parse(fs.readFileSync(file, "utf8"));
      const accessToken = doc?.auth?.accessToken;
      const identity = decodeJwtIdentity(accessToken);
      const uid = doc?.account?.uid || identity.uid;
      const tenantId = doc?.account?.tenantId || doc?.auth?.tenantId || identity.tenantId;
      const enterpriseId = doc?.account?.enterpriseId || doc?.auth?.enterpriseId || identity.enterpriseId;
      if (accessToken && uid) return { accessToken, uid, tenantId, enterpriseId };
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
  const providerData = credentials?.providerSpecificData || {};
  const overrideUid = providerData.workbuddyUserId;
  const overrideTenantId = providerData.workbuddyTenantId;
  const overrideEnterpriseId = providerData.workbuddyEnterpriseId;
  const withIdentity = (accessToken, identity = {}) => {
    const decoded = decodeJwtIdentity(accessToken);
    return {
      accessToken,
      uid: overrideUid || identity.uid || decoded.uid,
      tenantId: overrideTenantId || identity.tenantId || decoded.tenantId,
      enterpriseId: overrideEnterpriseId || identity.enterpriseId || decoded.enterpriseId,
    };
  };
  const pasted = typeof credentials?.apiKey === "string" ? credentials.apiKey.trim() : "";
  if (pasted && pasted !== "auto") {
    return withIdentity(pasted);
  }
  if (credentials?.accessToken) {
    return withIdentity(credentials.accessToken);
  }
  const local = readLocalSession();
  if (local) {
    return withIdentity(local.accessToken, local);
  }
  return null;
}

function rewriteIdentityText(text, role) {
  let out = text;
  for (const { pattern, to, roles } of WORKBUDDY_IDENTITY_REWRITES) {
    if (roles && !roles.includes(role)) continue;
    out = out.replace(pattern, to);
  }
  return out;
}

function rewriteIdentityContent(content, role) {
  if (typeof content === "string") return rewriteIdentityText(content, role);
  if (!Array.isArray(content)) return content;
  let changed = false;
  const next = content.map((part) => {
    if (part?.type !== "text" || typeof part.text !== "string") return part;
    const rewritten = rewriteIdentityText(part.text, role);
    if (rewritten === part.text) return part;
    changed = true;
    return { ...part, text: rewritten };
  });
  return changed ? next : content;
}

// Copies (never mutates) the messages that carry a blocked client identity.
// The gate is role-specific: system (identity sentence at line start) and
// assistant (the sentence anywhere) are scrubbed; user/tool content is left alone.
export function neutralizeChannelIdentity(messages) {
  let changed = false;
  const next = messages.map((msg) => {
    if (msg?.role !== "system" && msg?.role !== "assistant") return msg;
    const content = rewriteIdentityContent(msg.content, msg.role);
    if (content === msg.content) return msg;
    changed = true;
    return { ...msg, content };
  });
  return changed ? next : messages;
}

const WORKBUDDY_CLIENT_BODY_FIELDS = new Set([
  // Internal SDK bookkeeping that must never reach the OpenAI-compatible wire
  // body. ZCode currently uses all three names below.
  "bodySource",
  "providerOptions",
  "experimental_include",
  "client_metadata",
  "clientMetadata",
  "userAgent",
  // WorkBuddy's native serializer does not send these generic client hints.
  "metadata",
  "store",
]);

const WORKBUDDY_MESSAGE_FIELDS = {
  system: ["role", "content"],
  user: ["role", "content"],
  assistant: ["role", "content", "reasoning_content", "tool_calls"],
  tool: ["role", "content", "tool_call_id"],
};

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function textFromContentPart(part) {
  if (typeof part === "string") return part;
  if (part?.type === "text" && typeof part.text === "string") return part.text;
  return "";
}

function normalizeWorkbuddyContent(content, role) {
  if (content == null) {
    // CodeBuddy's native serializer always emits a string for assistant/tool
    // turns, including reasoning-only and pure tool-call turns.
    return role === "assistant" || role === "tool" || role === "system" ? "" : content;
  }
  if (!Array.isArray(content)) return content;

  // The native wire serializer uses a single string for system and tool turns.
  // User multimodal content remains an array so WorkBuddy vision models keep it.
  if (role === "system" || role === "tool") {
    return content.map(textFromContentPart).join("");
  }

  let changed = false;
  const next = content.map((part) => {
    if (!isPlainObject(part)) return part;
    const cleaned = { ...part };
    let partChanged = false;
    for (const key of ["signature", "cache_control", "cacheControl", "providerOptions"]) {
      if (hasOwn(cleaned, key)) {
        delete cleaned[key];
        partChanged = true;
      }
    }
    if (partChanged) changed = true;
    return partChanged ? cleaned : part;
  });
  return changed ? next : content;
}

function normalizeWorkbuddyToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls)) return toolCalls;
  let changed = false;
  const next = toolCalls.map((call) => {
    if (!isPlainObject(call)) return call;
    const fn = isPlainObject(call.function) ? call.function : null;
    if (!fn) return call;
    const normalizedFn = { ...fn };
    let callChanged = false;
    if (typeof normalizedFn.arguments !== "string") {
      normalizedFn.arguments = normalizedFn.arguments == null ? "{}" : JSON.stringify(normalizedFn.arguments);
      callChanged = true;
    }
    if (normalizedFn.name != null && typeof normalizedFn.name !== "string") {
      normalizedFn.name = String(normalizedFn.name);
      callChanged = true;
    }
    if (call.type !== "function") callChanged = true;
    if (!callChanged) return call;
    changed = true;
    return { ...call, type: "function", function: normalizedFn };
  });
  return changed ? next : toolCalls;
}

function normalizeWorkbuddyMessage(message) {
  if (!isPlainObject(message)) return message;
  const role = message.role === "developer" ? "system" : message.role;
  const fields = WORKBUDDY_MESSAGE_FIELDS[role];
  if (!fields) return message;

  const content = rewriteIdentityContent(normalizeWorkbuddyContent(message.content, role), role);
  const toolCalls = role === "assistant" ? normalizeWorkbuddyToolCalls(message.tool_calls) : undefined;
  const hasUnsupportedFields = Object.keys(message).some((key) => !fields.includes(key));
  const changedRole = role !== message.role;
  const changedContent = content !== message.content;
  const changedToolCalls = role === "assistant" && toolCalls !== message.tool_calls;
  if (!hasUnsupportedFields && !changedRole && !changedContent && !changedToolCalls) return message;

  const next = {};
  for (const key of fields) {
    if (!hasOwn(message, key) && key !== "role") continue;
    if (key === "role") next.role = role;
    else if (key === "content") next.content = content;
    else if (key === "tool_calls" && toolCalls !== undefined) next.tool_calls = toolCalls;
    else if (hasOwn(message, key)) next[key] = message[key];
  }
  return next;
}

/**
 * Normalize any client request into the WorkBuddy chat harness at the final
 * provider boundary. This intentionally runs after translation, context tools,
 * and token savers, because those stages can append a foreign system block after
 * an earlier sanitizer has already run.
 */
export function normalizeWorkbuddyHarness(messages) {
  if (!Array.isArray(messages)) return messages;
  const neutralized = neutralizeChannelIdentity(messages);
  let changed = neutralized !== messages;
  const next = neutralized.map((message) => {
    const normalized = normalizeWorkbuddyMessage(message);
    if (normalized !== message) changed = true;
    return normalized;
  });
  return changed ? next : messages;
}

function cloneWorkbuddyBody(body) {
  if (!isPlainObject(body)) return body;
  const cloned = { ...body };
  // DefaultExecutor's only message-mutating compatibility pass for this path is
  // the json_schema fallback. Keep the common path reference-preserving so user
  // and tool turns remain byte-for-byte objects, while still isolating that rare
  // in-place fallback from the caller's retry body.
  if (body.response_format?.type === "json_schema" && Array.isArray(body.messages)) {
    cloned.messages = body.messages.map((message) => {
      if (!isPlainObject(message)) return message;
      const next = { ...message };
      if (Array.isArray(message.content)) next.content = message.content.map((part) => isPlainObject(part) ? { ...part } : part);
      if (Array.isArray(message.tool_calls)) {
        next.tool_calls = message.tool_calls.map((call) => isPlainObject(call)
          ? { ...call, ...(isPlainObject(call.function) ? { function: { ...call.function } } : {}) }
          : call);
      }
      return next;
    });
  }
  return cloned;
}

function normalizeWorkbuddyBody(model, body, stream) {
  const out = { ...body };
  for (const key of WORKBUDDY_CLIENT_BODY_FIELDS) delete out[key];

  // WorkBuddy's chat plane validates reasoning_effort per model and rejects any
  // value it does not recognise (400 code 11150 invalid_reasoning_effort). Its
  // native CLI never sends OpenAI-style effort, so drop it and let the model
  // reason at its own default level instead of letting a client guess fail the
  // whole request.
  delete out.reasoning_effort;

  const requestedModel = typeof model === "string" && model.trim() ? model.trim() : out.model;
  if (typeof requestedModel === "string" && requestedModel.trim()) {
    out.model = requestedModel.replace(/^(?:wb|workbuddy)\//i, "");
  }

  // WorkBuddy's chat plane is streaming-only and reports usage in the terminal
  // stream event. Keep any caller options, but force usage on for the gateway.
  out.stream = stream;
  if (stream) {
    out.stream_options = {
      ...(isPlainObject(out.stream_options) ? out.stream_options : {}),
      include_usage: true,
    };
  }

  // OpenAI clients use three names for the output cap; WorkBuddy's native wire
  // serializer uses max_tokens. Preserve the explicit max_tokens value when set.
  if (out.max_tokens == null) {
    const fallback = out.max_completion_tokens ?? out.max_output_tokens;
    if (fallback != null) out.max_tokens = fallback;
  }
  delete out.max_completion_tokens;
  delete out.max_output_tokens;

  out.messages = normalizeWorkbuddyHarness(out.messages);
  return out;
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
    if (session.tenantId) headers["X-Tenant-Id"] = session.tenantId;
    if (session.enterpriseId) headers["X-Enterprise-Id"] = session.enterpriseId;
    // WorkBuddy's chat plane expects the CLI client identity. This is deliberately
    // separate from the VSCode identity used by the catalog resolver.
    headers["User-Agent"] = WORKBUDDY_CHAT_USER_AGENT;
    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    // BaseExecutor and the OpenAI formatter contain in-place compatibility passes.
    // Give them a private shallow/deep-enough copy so account fallback and retries
    // never reuse a body whose prompt or metadata was already rewritten.
    const transformed = super.transformRequest(model, cloneWorkbuddyBody(body), stream, credentials);
    if (!transformed || typeof transformed !== "object" || !Array.isArray(transformed.messages)) {
      return transformed;
    }
    const normalized = normalizeWorkbuddyBody(model, transformed, stream);
    // Registry forceStream coerces the effective stream flag to true even when
    // the client asked for a non-streaming response, but the body would still
    // carry the client's stream:false — upstream rejects that (code 11101).
    const messages = normalized.messages;
    const first = messages[0];
    if (first?.role === "system") {
      return normalized;
    }
    return {
      ...normalized,
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
