import { NextResponse } from "next/server";
import { validateApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

let cachedCliToken = null;
async function getCliToken() {
  if (!cachedCliToken) cachedCliToken = await getConsistentMachineId(CLI_TOKEN_SALT);
  return cachedCliToken;
}

async function hasValidCliToken(request) {
  const token = request.headers.get(CLI_TOKEN_HEADER);
  if (!token) return false;
  return token === await getCliToken();
}
export { hasValidCliToken };

// Public API paths — no auth required (LLM API has its own key auth inside handler).
const PUBLIC_API_PATHS = [
  "/api/health",
  "/api/locale",
];

// Public top-level prefixes (LLM API endpoints with their own API key auth).
// NOTE: /v1 is the ONE public gateway surface since 0.10.0 — the /codex,
// /responses and /v1beta client surfaces were removed (rewrites gone from
// next.config.mjs, /api/v1beta routes deleted). Codex CLI talks Responses API
// through <origin>/v1/responses; Gemini-native clients must use /v1 instead.
const PUBLIC_PREFIXES = ["/v1"];

// Host-secret and process-control routes remain local/CLI-token protected.
const ALWAYS_PROTECTED = [
  "/api/shutdown",
  "/api/settings/database",
  "/api/app/shutdown",
];

// Routes that spawn child processes or read host secrets — restrict to localhost.
const LOCAL_ONLY_PATHS = [
  "/api/cli-tools/cowork-settings",
  "/api/mcp/",
];

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isLoopbackHostname(h) {
  if (!h) return false;
  const value = String(h).trim().toLowerCase();
  let name = value;
  if (value.startsWith("[")) {
    const closingBracket = value.indexOf("]");
    name = value.slice(1, closingBracket > 0 ? closingBracket : undefined);
  } else {
    const separator = value.lastIndexOf(":");
    if (separator > -1 && value.indexOf(":") === separator) {
      name = value.slice(0, separator);
    }
  }
  return LOOPBACK_HOSTS.has(name);
}

let warnedMissingLocalStamp = false;
function warnMissingLocalStamp() {
  if (warnedMissingLocalStamp) return;
  warnedMissingLocalStamp = true;
  console.error(
    "[SECURITY] local-only routes are NOT protected: requests are not passing through " +
    "custom-server.js (x-9r-real-ip header missing) while NODE_ENV=production. " +
    "Run via `npm start` (custom-server.js). The client-supplied Host header is NOT trusted as a local indicator."
  );
}

export function isLocalRequest(request) {
  // Stamped by custom-server.js when forwarding headers exist: request came through
  // a reverse proxy, so the loopback socket is the proxy hop, not the end-user.
  if (request.headers.get("x-9r-via-proxy")) return false;
  // Trusted peer IP from TCP socket (custom-server.js); unspoofable. Primary anchor for "local".
  const realIp = request.headers.get("x-9r-real-ip");
  if (realIp) {
    if (!isLoopbackHostname(realIp)) return false;
  } else if (process.env.NODE_ENV === "production") {
    // Production without custom-server stamping (x-9r-real-ip missing): the
    // "local-only" guarantee is not enforceable, so never trust the client-supplied
    // Host header as a local indicator. Dev/test keep the legacy Host check.
    warnMissingLocalStamp();
    return false;
  } else if (!isLoopbackHostname(request.headers.get("host"))) {
    // Fallback for bare server.js (dev/test) without custom-server: legacy Host-based check.
    return false;
  }
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (!isLoopbackHostname(new URL(origin).hostname)) return false;
    } catch { return false; }
  }
  return true;
}

// Personal/local mode: the Web dashboard is deliberately loopback-only and
// never presents a dashboard login screen.
export function canAccessLocalDashboard(request) {
  return isLocalRequest(request);
}

function isPublicLlmApi(pathname) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function extractApiKey(request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  const apiKeyHeader = request.headers.get("x-api-key");
  if (apiKeyHeader) return apiKeyHeader;
  const googleApiKeyHeader = request.headers.get("x-goog-api-key");
  if (googleApiKeyHeader) return googleApiKeyHeader;
  return request.nextUrl.searchParams?.get("key") || null;
}

async function hasValidApiKey(request) {
  const apiKey = extractApiKey(request);
  if (!apiKey) return false;
  return await validateApiKey(apiKey);
}

async function canAccessPublicLlmApi(request) {
  if (isLocalRequest(request)) return true;
  if (await hasValidCliToken(request)) return true;
  return await hasValidApiKey(request);
}

async function canAccessLocalOnlyRoute(request) {
  if (canAccessLocalDashboard(request)) return true;
  if (await hasValidCliToken(request)) return true;
  return false;
}

function isPublicApi(pathname) {
  if (isPublicLlmApi(pathname)) return true;
  return PUBLIC_API_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export const __test__ = {
  isLocalRequest,
  canAccessLocalDashboard,
  isPublicLlmApi,
  extractApiKey,
  canAccessPublicLlmApi,
  canAccessLocalOnlyRoute,
};

export async function proxy(request) {
  const { pathname } = request.nextUrl;

  // Local-only gate for spawn-capable / host-secret routes.
  if (LOCAL_ONLY_PATHS.some((p) => pathname.startsWith(p))) {
    if (!(await canAccessLocalOnlyRoute(request))) {
      return NextResponse.json({ error: "Local only: CLI token required" }, { status: 403 });
    }
  }

  // Always protected - require a loopback request or local CLI token.
  if (ALWAYS_PROTECTED.some((p) => pathname.startsWith(p))) {
    if (canAccessLocalDashboard(request) || await hasValidCliToken(request))
      return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isPublicLlmApi(pathname)) {
    if (await canAccessPublicLlmApi(request)) return NextResponse.next();
    return NextResponse.json({ error: "API key required for API access" }, { status: 401 });
  }

  // Deny-by-default for /api/* — public allow-list bypasses, everything else requires auth.
  if (pathname.startsWith("/api/")) {
    if (!isLocalRequest(request) && !(await hasValidCliToken(request))) {
      return NextResponse.json({ error: "Switch-Router is local-only" }, { status: 403 });
    }
    if (isPublicApi(pathname)) return NextResponse.next();
    if (canAccessLocalDashboard(request) || await hasValidCliToken(request))
      return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Protect all dashboard routes
  if (pathname.startsWith("/dashboard")) {
    if (canAccessLocalDashboard(request)) return NextResponse.next();
    return NextResponse.json({ error: "Switch-Router dashboard is local-only" }, { status: 403 });
  }

  // Redirect / to /dashboard if logged in, or /dashboard if it's the root
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}
