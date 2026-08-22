import { getApiKeys } from "@/lib/localDb";
import { SERVER_CONFIG } from "@/shared/constants/config";
import { getConsistentMachineId } from "@/shared/utils/machineId";

const CLI_TOKEN_SALT = "9r-cli-auth";

async function getInternalHeaders() {
  let apiKey = null;
  try {
    const keys = await getApiKeys();
    apiKey = keys.find((k) => k.isActive !== false)?.key || null;
  } catch {}

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  headers["x-9r-cli-token"] = await getConsistentMachineId(CLI_TOKEN_SALT);
  // Dashboard model-test probes: one account, no cooldown locks, no cascade.
  headers["x-9r-probe"] = "1";
  return headers;
}

function pingTimeoutMs(model) {
  const id = String(model || "").toLowerCase();
  // Antigravity / Gemini Cloud Code often spend 20–60s on cold start or 429
  // round-trips; a 15s AbortSignal only surfaces "operation aborted" and hides
  // the real upstream status (measured ~49s for ag/gemini-3.7-flash-low → 429).
  if (
    id.startsWith("ag/")
    || id.startsWith("antigravity/")
    || id.startsWith("gc/")
    || id.startsWith("gemini-cli/")
    || id.includes("gemini-3.")
    || id.includes("gemini-pro-agent")
  ) {
    return 90000;
  }
  return 30000;
}

export async function pingModelByKind(model, kind, baseUrl = `http://127.0.0.1:${process.env.PORT || SERVER_CONFIG.appPort}`) {
  const headers = await getInternalHeaders();
  const start = Date.now();
  const timeoutMs = pingTimeoutMs(model);

  let res;
  try {
    res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        // Claude-on-Copilot returns empty choices at max_tokens:1 (budget is spent
        // before a content token emits), so a 1-token probe yields a false negative.
        max_tokens: 16,
        stream: false,
        messages: [{ role: "user", content: "hi" }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const latencyMs = Date.now() - start;
    const timedOut = err?.name === "TimeoutError" || /aborted|timeout/i.test(err?.message || "");
    return {
      ok: false,
      latencyMs,
      error: timedOut
        ? `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${model}`
        : (err?.message || "Network error"),
    };
  }
  const latencyMs = Date.now() - start;

  const rawText = await res.text().catch(() => "");
  let parsed = null;
  try { parsed = rawText ? JSON.parse(rawText) : null; } catch {}

  if (!res.ok) {
    const detail = parsed?.error?.message || parsed?.msg || parsed?.message || parsed?.error || rawText;
    const detailStr = detail ? String(detail).replace(/\s+/g, " ").slice(0, 280) : "";
    // Surface quota/rate-limit clearly (common on Antigravity 3.7 probes).
    const isQuota = res.status === 429 || /resource.?exhausted|rate.?limit|quota/i.test(detailStr);
    return {
      ok: false,
      latencyMs,
      status: res.status,
      error: isQuota
        ? `HTTP 429 quota/rate-limit${detailStr ? `: ${detailStr}` : ""}`
        : `HTTP ${res.status}${detailStr ? `: ${detailStr}` : ""}`,
    };
  }

  const providerStatus = parsed?.status;
  const providerMsg = parsed?.msg || parsed?.message;
  const hasProviderErrorStatus = providerStatus !== undefined
    && providerStatus !== null
    && String(providerStatus) !== "200"
    && String(providerStatus) !== "0";
  if (hasProviderErrorStatus && providerMsg) {
    return {
      ok: false,
      latencyMs,
      status: res.status,
      error: `Provider status ${providerStatus}: ${String(providerMsg).slice(0, 240)}`,
    };
  }

  if (parsed?.error) {
    const providerError = parsed?.error?.message || parsed?.error || "Provider returned an error";
    return {
      ok: false,
      latencyMs,
      status: res.status,
      error: String(providerError).slice(0, 240),
    };
  }

  const hasChoices = Array.isArray(parsed?.choices) && parsed.choices.length > 0;
  if (!hasChoices) {
    return {
      ok: false,
      latencyMs,
      status: res.status,
      error: "Provider returned no completion choices for this model",
    };
  }

  return { ok: true, latencyMs, error: null, status: res.status };
}
