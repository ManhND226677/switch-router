const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { WebSocket, WebSocketServer } = require("ws");

// Load .env first, then .env.local: loadEnvFile overwrites already-set vars,
// so .env.local keeps precedence — same ordering Next applies in dev. Without
// this, variables present only in .env were silently ignored in production.
if (typeof process.loadEnvFile === "function") {
  const envFile = path.join(__dirname, ".env");
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const localEnvFile = path.join(__dirname, ".env.local");
  if (fs.existsSync(localEnvFile)) process.loadEnvFile(localEnvFile);
}

if (!process.env.SWITCH_ROUTER_INTERNAL_SECRET) {
  process.env.SWITCH_ROUTER_INTERNAL_SECRET = crypto.randomBytes(32).toString("hex");
}

// The standalone build receives its runtime settings from the environment.
// Keep source checkouts local by default while allowing explicit runtime values.
if (!process.env.PORT) process.env.PORT = "28701";
if (!process.env.HOSTNAME) process.env.HOSTNAME = "127.0.0.1";

const origCreate = http.createServer.bind(http);

const realtimeServer = new WebSocketServer({ noServer: true, clientTracking: false });

// High-water mark for the realtime relay buffer; above this we pause the slow peer.
const REALTIME_HIGH_WATER = 1 << 20;

function sendUpgradeError(socket, status, message) {
  if (!socket || socket.destroyed || !socket.writable) return;
  socket.write(`HTTP/1.1 ${status} Error\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`);
  socket.destroy();
}

function getRealtimeSelector(request) {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  return {
    connectionId: request.headers["x-connection-id"] || url.searchParams.get("connection_id") || null,
    provider: request.headers["x-provider"] || url.searchParams.get("provider") || "stepfun",
    apiMode: request.headers["x-stepfun-api-mode"] || url.searchParams.get("api_mode") || null,
    model: (url.searchParams.get("model") || "stepaudio-2.5-realtime").replace(/^stepfun\//, ""),
    url,
  };
}

async function resolveRealtimeToken(request, selector, signal) {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) return { token: authorization.slice(7), apiMode: selector.apiMode };

  const directToken = selector.url.searchParams.get("api_key") || selector.url.searchParams.get("token");
  if (directToken) return { token: directToken, apiMode: selector.apiMode };

  const response = await fetch(`http://127.0.0.1:${process.env.PORT}/api/internal/stepfun-credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-switch-router-internal-secret": process.env.SWITCH_ROUTER_INTERNAL_SECRET,
    },
    body: JSON.stringify({ provider: selector.provider, connectionId: selector.connectionId }),
    signal,
  });
  if (!response.ok) return null;
  const body = await response.json();
  return body.token ? { token: body.token, apiMode: body.apiMode || null } : null;
}

function handleRealtimeUpgrade(request, socket, head) {
  const selector = getRealtimeSelector(request);
  if (selector.provider !== "stepfun") return sendUpgradeError(socket, 404, "StepFun realtime route not found");
  if (!selector.model || selector.model.includes("..")) return sendUpgradeError(socket, 400, "Invalid realtime model");

  let upgradeSettled = false;
  const failUpgrade = (status, message) => {
    if (upgradeSettled) return;
    upgradeSettled = true;
    sendUpgradeError(socket, status, message);
  };

  const tokenAc = new AbortController();
  request.socket.once("close", () => tokenAc.abort());
  resolveRealtimeToken(request, selector, tokenAc.signal).then((auth) => {
    if (!auth?.token) return failUpgrade(401, "No active StepFun credentials");
    const realtimeBase = auth.apiMode === "payg"
      ? "wss://api.stepfun.ai/v1/realtime"
      : "wss://api.stepfun.ai/step_plan/v1/realtime";
    const upstreamUrl = `${realtimeBase}?model=${encodeURIComponent(selector.model)}`;
    const upstream = new WebSocket(upstreamUrl, {
      headers: { Authorization: `Bearer ${auth.token}` },
      handshakeTimeout: 15000,
    });

    upstream.once("open", () => {
      upgradeSettled = true;
      realtimeServer.handleUpgrade(request, socket, head, (client) => {
        client.on("message", (data, isBinary) => {
          if (upstream.readyState === WebSocket.OPEN) {
            upstream.send(data, { binary: isBinary });
            if (upstream.bufferedAmount > REALTIME_HIGH_WATER) client.pause();
          }
        });
        client.on("drain", () => upstream.resume());
        client.on("close", () => {
          if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
        });
        client.on("error", () => upstream.close());
        upstream.on("message", (data, isBinary) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(data, { binary: isBinary });
            if (client.bufferedAmount > REALTIME_HIGH_WATER) upstream.pause();
          }
        });
        upstream.on("drain", () => client.resume());
        upstream.on("close", (code, reason) => {
          if (client.readyState === WebSocket.OPEN) client.close(code, reason);
        });
        upstream.on("error", () => {
          if (client.readyState === WebSocket.OPEN) client.close(1011, "Upstream realtime error");
        });
      });
    });
    upstream.once("unexpected-response", (_request, response) => {
      response.resume();
      failUpgrade(response.statusCode || 502, "StepFun realtime connection failed");
    });
    upstream.once("error", () => {
      failUpgrade(502, "StepFun realtime connection failed");
    });
  }).catch(() => failUpgrade(502, "StepFun realtime connection failed"));
}

// Wrap Next standalone HTTP server: derive client IP from the TCP socket
// (unspoofable) and strip client-supplied forwarding headers so downstream
// rate-limiting keys on the real peer address instead of attacker-controlled XFF.
http.createServer = (...args) => {
  const handler = args.find((a) => typeof a === "function");
  const rest = args.filter((a) => typeof a !== "function");
  if (!handler) return origCreate(...args);
  const wrapped = (req, res) => {
    const socketIp = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "";
    const xff = req.headers["x-forwarded-for"];
    const xRealIp = req.headers["x-real-ip"];
    const viaProxy = !!(xff || xRealIp);
    const isLoopbackProxy = socketIp === "127.0.0.1" || socketIp === "::1" || socketIp === "::ffff:127.0.0.1";
    // Trust forwarding headers only when the TCP peer is a local reverse proxy.
    // Direct/public sockets remain keyed by the unspoofable peer address.
    const proxyIp = xRealIp || (xff ? String(xff).split(",")[0].trim() : "");
    const ip = isLoopbackProxy && proxyIp ? proxyIp : socketIp;
    delete req.headers["x-9r-real-ip"];
    delete req.headers["x-forwarded-for"];
    delete req.headers["x-9r-via-proxy"];
    req.headers["x-9r-real-ip"] = ip;
    if (viaProxy) req.headers["x-9r-via-proxy"] = "1";
    return handler(req, res);
  };
  const server = origCreate(...rest, wrapped);
  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
    if (pathname === "/v1/realtime" || pathname === "/api/v1/realtime") {
      handleRealtimeUpgrade(req, socket, head);
    }
  });
  return server;
};

const bundledServer = path.join(__dirname, "server.js");
const localStandaloneServer = path.join(__dirname, ".next", "standalone", "server.js");
const serverEntry = fs.existsSync(bundledServer) ? bundledServer : localStandaloneServer;

function linkStandaloneDirectory(sourceDir, targetDir) {
  if (fs.existsSync(sourceDir) && !fs.existsSync(targetDir)) {
    fs.symlinkSync(sourceDir, targetDir, process.platform === "win32" ? "junction" : "dir");
  }
}

if (!fs.existsSync(serverEntry)) {
  throw new Error("Standalone server not found. Run `npm run build` before `npm run start`.");
}

// Next's standalone output leaves `.next/static` outside the traced server.
// Link it into the local standalone tree so dynamic app chunks are reachable.
if (serverEntry === localStandaloneServer) {
  const buildStaticDir = path.join(__dirname, ".next", "static");
  const standaloneStaticDir = path.join(__dirname, ".next", "standalone", ".next", "static");
  const buildPublicDir = path.join(__dirname, "public");
  const standalonePublicDir = path.join(__dirname, ".next", "standalone", "public");
  linkStandaloneDirectory(buildStaticDir, standaloneStaticDir);
  linkStandaloneDirectory(buildPublicDir, standalonePublicDir);
}

require(serverEntry);
