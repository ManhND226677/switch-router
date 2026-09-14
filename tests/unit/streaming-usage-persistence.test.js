// Regression: a successful chat request must land in usageHistory / usageDaily.
//
// Bug: Kilo Code (and every other OpenAI-compatible upstream) reports token
// usage ONLY in a terminal SSE chunk and only when the request carries
// `stream_options: { include_usage: true }`. The gateway never sent that flag,
// so the stream carried no usage at all; when the stream also carried no text to
// estimate from, `saveUsageStats()` bailed out on 0/0 tokens and the request
// never appeared on the Usage screen — even though requestDetails had a row and
// the client got HTTP 200.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const PROVIDER = "kilocode";
const CONNECTION_ID = "conn-usage-e2e";

function sse(events) {
  return events.map((e) => `data: ${JSON.stringify(e)}\n`).join("") + "data: [DONE]\n\n";
}

// Terminal-chunk shape an OpenAI-compatible upstream emits for
// stream_options.include_usage: finish chunk first, then a usage-only chunk
// with an empty `choices` array.
const SSE_WITH_USAGE = sse([
  { id: "gen-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "Hello" } }] },
  { id: "gen-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
  { id: "gen-1", object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: 753, completion_tokens: 16, total_tokens: 769 } },
]);

// Truncated stream: only a role + tool-call delta, then EOF — no finish chunk,
// no usage, no text. Nothing to estimate from, so usage stays unknown. This is
// the shape that used to vanish from usageHistory entirely.
const SSE_USAGE_UNKNOWN = sse([
  { id: "gen-2", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_1", function: { name: "Read", arguments: "{}" } }] } }] },
]);

function buildBody(model) {
  return { model, stream: true, messages: [{ role: "user", content: "x".repeat(400) }] };
}

describe("streaming usage reaches usageHistory", () => {
  const originalDataDir = process.env.DATA_DIR;
  let tempDir;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sr-usage-e2e-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
  });

  afterAll(async () => {
    try {
      const { getAdapterSync } = await import("@/lib/db/driver.js");
      getAdapterSync()?.close?.();
    } catch { /* driver may not have loaded */ }
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  // Run one upstream SSE body through the real passthrough transform + the real
  // onStreamComplete callback — the same path chatCore uses for a 200 response.
  async function dispatch(model, sseText) {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    const { createPassthroughStreamWithLogger } = await import("open-sse/utils/stream.js");
    const { buildOnStreamComplete } = await import("open-sse/handlers/chatCore/streamingHandler.js");

    const body = buildBody(model);
    const { onStreamComplete } = buildOnStreamComplete({
      provider: PROVIDER, model, connectionId: CONNECTION_ID, apiKey: "sk-test",
      requestStartTime: Date.now(), body, stream: true,
      clientRawRequest: { endpoint: "/v1/chat/completions" },
    });
    const ts = createPassthroughStreamWithLogger(PROVIDER, null, model, CONNECTION_ID, body, onStreamComplete);
    const upstream = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode(sseText)); c.close(); },
    });
    await upstream.pipeThrough(ts).pipeTo(new WritableStream({ write() { } }));

    await db.flushPendingUsage();
    return db;
  }

  function rawUsageRows(adapter, model) {
    return adapter.all(
      `SELECT promptTokens, completionTokens, meta FROM usageHistory WHERE provider = ? AND model = ? ORDER BY id ASC`,
      [PROVIDER, model],
    );
  }

  it("asks OpenAI-compatible upstreams for usage (stream_options.include_usage)", async () => {
    const { getExecutor } = await import("open-sse/executors/index.js");
    const body = buildBody("kc/nex-agi/nex-n2.5-pro:free");
    getExecutor(PROVIDER).transformRequest("kc/nex-agi/nex-n2.5-pro:free", body, true, {});
    expect(body.stream_options?.include_usage).toBe(true);
  });

  it("keeps caller-supplied stream_options and skips non-OpenAI formats", async () => {
    const { getExecutor } = await import("open-sse/executors/index.js");
    const exec = getExecutor(PROVIDER);
    const model = "kc/nex-agi/nex-n2.5-pro:free";

    const withCallerOptions = { ...buildBody(model), stream_options: { continuous_usage_stats: true } };
    exec.transformRequest(model, withCallerOptions, true, {});
    expect(withCallerOptions.stream_options).toEqual({ continuous_usage_stats: true, include_usage: true });

    const claudeBody = buildBody(model);
    exec.transformRequest(model, claudeBody, true, { runtimeTransport: { format: "claude" } });
    expect(claudeBody.stream_options).toBeUndefined();

    const nonStream = { model, stream: false, messages: [] };
    exec.transformRequest(model, nonStream, false, {});
    expect(nonStream.stream_options).toBeUndefined();
  });

  it("persists provider-reported usage end-to-end (753/16, not the estimate)", async () => {
    const model = "kc/e2e/with-usage";
    const db = await dispatch(model, SSE_WITH_USAGE);

    const rows = await db.getUsageHistory({ provider: PROVIDER, model });
    expect(rows.length).toBe(1);
    // A content-based estimate carries a +2000 token buffer, so a real usage
    // chunk must replace it instead of being max-merged on top of it.
    expect(rows[0].tokens.prompt_tokens).toBe(753);
    expect(rows[0].tokens.completion_tokens).toBe(16);
  });

  it("counts the request in usageDaily and totalRequestsLifetime", async () => {
    const model = "kc/e2e/counters";
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    const lifetimeBefore = Number(adapter.get(`SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'`)?.value || 0);

    await dispatch(model, SSE_WITH_USAGE);
    await dispatch(`${model}-unknown`, SSE_USAGE_UNKNOWN);

    const lifetimeAfter = Number(adapter.get(`SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'`)?.value || 0);
    expect(lifetimeAfter).toBe(lifetimeBefore + 2);

    const dayRows = adapter.all(`SELECT dateKey, data FROM usageDaily`);
    const requests = dayRows.reduce((sum, r) => sum + (JSON.parse(r.data).requests || 0), 0);
    expect(requests).toBeGreaterThanOrEqual(1);
  });

  it("still records a request whose usage could not be captured (usageMissing)", async () => {
    const model = "kc/e2e/usage-missing";
    const db = await dispatch(model, SSE_USAGE_UNKNOWN);
    const { getAdapter } = await import("@/lib/db/driver.js");

    const rows = rawUsageRows(await getAdapter(), model);
    expect(rows.length).toBe(1);
    expect(rows[0].promptTokens).toBe(0);
    expect(rows[0].completionTokens).toBe(0);
    // Flagged so a 0-token "unknown" row can be told apart from a real one and
    // excluded from token/cost aggregates.
    expect(JSON.parse(rows[0].meta)).toEqual({ usageMissing: true });

    const history = await db.getUsageHistory({ provider: PROVIDER, model });
    expect(history.length).toBe(1);
  });
});
