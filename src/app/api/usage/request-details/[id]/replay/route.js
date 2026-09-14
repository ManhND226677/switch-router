import { NextResponse } from "next/server";
import { getRequestDetailById } from "@/lib/usageDb";
import { getApiKeys } from "@/lib/localDb";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";

export const dynamic = "force-dynamic";

let initialized = false;
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

// Replay is a debugging call against the user's own providers: probe mode
// (x-9r-probe) so one click cannot lock the whole account pool, non-streaming
// so the dashboard gets one JSON result, and a hard cap so a hung upstream
// cannot pin this route handler forever.
const REPLAY_TIMEOUT_MS = 120_000;
const MAX_RESULT_CHARS = 8_000;

function badRequest(message) {
  return NextResponse.json({ error: message }, { status: 400 });
}

// handleChat enforces the gateway's own requireApiKey policy even for internal
// callers, so a keyless replay 401s on setups with API keys enabled. Replay is
// already behind dashboardGuard — attach an active key that the model request
// passes policy-wise (allowlist empty or covering it), preferring unrestricted
// keys so budget/RPM can't veto an admin debug call. None found → 401 surfaces.
async function pickReplayKey(modelStr) {
  try {
    const keys = await getApiKeys();
    const now = Date.now();
    const usable = (keys || []).filter((k) => k.isActive
      && (!k.expiresAt || Date.parse(k.expiresAt) > now)
      && (!Array.isArray(k.allowedModels) || k.allowedModels.length === 0 || k.allowedModels.includes(modelStr)));
    const unrestricted = usable.find((k) => k.monthlyBudgetUsd == null && k.rateLimitRpm == null);
    return (unrestricted || usable[0])?.key || null;
  } catch {
    return null;
  }
}

export async function POST(_request, { params }) {
  const { id } = await params;
  if (typeof id !== "string" || !id) return badRequest("Missing request id");

  let detail;
  try {
    detail = await getRequestDetailById(id);
  } catch (error) {
    console.error("[replay] failed to load request detail:", error);
    return NextResponse.json({ error: "Không đọc được request đã lưu" }, { status: 500 });
  }
  if (!detail) {
    return NextResponse.json({ error: "Không tìm thấy request" }, { status: 404 });
  }

  const saved = detail.request;
  if (!saved || typeof saved !== "object" || saved._truncated) {
    return badRequest("Payload bị cắt ngắn khi lưu — không replay được. Tăng 'Kích thước JSON tối đa' trong Profile rồi test lại.");
  }
  if (typeof saved.model !== "string" || !saved.model) {
    return badRequest("Request đã lưu không có model — không replay được.");
  }
  const hasMessages = Array.isArray(saved.messages) && saved.messages.length > 0;
  const hasInput = Array.isArray(saved.input) && saved.input.length > 0;
  if (!hasMessages && !hasInput) {
    return badRequest("Request đã lưu không có messages — không replay được.");
  }

  await ensureInitialized();

  const body = { ...saved, stream: false };
  const headers = {
    "content-type": "application/json",
    "x-9r-probe": "1",
  };
  const replayKey = await pickReplayKey(saved.model);
  if (replayKey) headers.authorization = `Bearer ${replayKey}`;

  const chatRequest = new Request("http://127.0.0.1/api/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const startedAt = Date.now();
  let timer;
  let response;
  try {
    response = await Promise.race([
      handleChat(chatRequest),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("replay-timeout")), REPLAY_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    const timeout = error?.message === "replay-timeout";
    return NextResponse.json({
      status: timeout ? 504 : 500,
      ok: false,
      latencyMs: Date.now() - startedAt,
      model: saved.model,
      error: timeout ? `Replay vượt quá ${REPLAY_TIMEOUT_MS / 1000}s` : error?.message || String(error),
    });
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text().catch(() => "");
  let result;
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    const json = JSON.stringify(parsed, null, 2);
    result = json.length > MAX_RESULT_CHARS ? json.slice(0, MAX_RESULT_CHARS) + "\n… [cắt bớt]" : json;
  } catch {
    result = raw.length > MAX_RESULT_CHARS ? raw.slice(0, MAX_RESULT_CHARS) + "\n… [cắt bớt]" : raw;
  }

  return NextResponse.json({
    status: response.status,
    ok: response.ok,
    latencyMs: Date.now() - startedAt,
    model: saved.model,
    result,
  });
}
