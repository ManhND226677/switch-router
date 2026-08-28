// Regression tests for the Phase 3/4 streaming + event-loop optimizations:
//  1. Cursor true-streaming (TTFT = first upstream frame, pooled HTTP/2 ready)
//  2. Tool-argument fragment merge (incremental scan gate) correctness
//  3. Usage write-behind queue semantics
//  4. estimateInputTokens per-request memoization
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { CursorExecutor } from "../../open-sse/executors/cursor.js";
import { encodeField, wrapConnectRPCFrame } from "../../open-sse/utils/cursorProtobuf.js";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

const LEN = 2;

function cursorTextFrame(text) {
  const response = Buffer.from(encodeField(1, LEN, text));
  const envelope = encodeField(2, LEN, response);
  return Buffer.from(wrapConnectRPCFrame(envelope));
}

function jsonErrorFrame(obj) {
  const payload = Buffer.from(JSON.stringify(obj));
  const header = Buffer.alloc(5);
  header[0] = 0; // COMPRESS_FLAG.NONE
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

function webStreamOfChunks(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

function parseSSE(text) {
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => chunk.slice("data: ".length))
    .filter((data) => data !== "[DONE]")
    .map((data) => JSON.parse(data));
}

// Compare event streams ignoring the per-response id/created fields.
function comparableEvents(text) {
  return parseSSE(text).map((e) => ({ ...e, id: undefined, created: undefined }));
}

describe("CursorExecutor true streaming", () => {
  it("streaming output is byte-for-byte equivalent to the buffered transform", async () => {
    const executor = new CursorExecutor();
    const buffer = Buffer.concat([
      cursorTextFrame("Hello"),
      cursorTextFrame(" "),
      cursorTextFrame("world"),
    ]);
    const body = { messages: [{ role: "user", content: "hi" }] };

    const buffered = executor.transformProtobufToSSE(buffer, "gpt-5.3-codex", body);
    const { response: streamed } = await executor.buildStreamingSseResponse(
      { status: 200, byteStream: webStreamOfChunks([buffer]) },
      "http://cursor.invalid/chat", {}, "gpt-5.3-codex", body,
    );

    expect(streamed.status).toBe(200);
    expect(comparableEvents(await streamed.text())).toEqual(comparableEvents(await buffered.text()));
  });

  it("forwards the first frame before the rest of the body exists (TTFT = first frame)", async () => {
    const executor = new CursorExecutor();
    const body = { messages: [{ role: "user", content: "hi" }] };

    let releaseSecond;
    const secondArrived = new Promise((resolve) => { releaseSecond = resolve; });
    let pushedSecond = false;
    const upstream = new ReadableStream({
      start(controller) {
        controller.enqueue(cursorTextFrame("first "));
        secondArrived.then(() => {
          pushedSecond = true;
          controller.enqueue(cursorTextFrame("second"));
          controller.close();
        });
      },
    });

    const { response } = await executor.buildStreamingSseResponse(
      { status: 200, byteStream: upstream }, "http://cursor.invalid/chat", {}, "gpt-5.3-codex", body,
    );

    const reader = response.body.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    const firstText = new TextDecoder().decode(first.value);
    expect(firstText).toContain("first ");
    // The second frame has NOT been produced upstream yet — proves incremental streaming.
    expect(pushedSecond).toBe(false);

    releaseSecond();
    let rest = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += new TextDecoder().decode(value);
    }
    expect(rest).toContain("second");
    expect(rest).toContain("[DONE]");
  });

  it("returns a real error Response when the error frame arrives before any content", async () => {
    const executor = new CursorExecutor();
    const body = { messages: [{ role: "user", content: "hi" }] };
    const errorFrame = jsonErrorFrame({
      error: { code: "resource_exhausted", message: "You've hit your rate limit", details: [] },
    });

    const { response } = await executor.buildStreamingSseResponse(
      { status: 200, byteStream: webStreamOfChunks([errorFrame]) },
      "http://cursor.invalid/chat", {}, "gpt-5.3-codex", body,
    );

    expect(response.status).toBe(429);
    const payload = await response.json();
    expect(payload.error.type).toBe("rate_limit_error");
  });

  it("finalizes cleanly when an error frame arrives after content", async () => {
    const executor = new CursorExecutor();
    const body = { messages: [{ role: "user", content: "hi" }] };
    const frames = [
      cursorTextFrame("partial answer"),
      jsonErrorFrame({ error: { code: "resource_exhausted", message: "late failure", details: [] } }),
    ];

    const { response } = await executor.buildStreamingSseResponse(
      { status: 200, byteStream: webStreamOfChunks(frames) },
      "http://cursor.invalid/chat", {}, "gpt-5.3-codex", body,
    );

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("partial answer");
    expect(text).toContain("[DONE]");
  });

  it("split frame bytes across chunks still parse (incomplete frame buffering)", async () => {
    const executor = new CursorExecutor();
    const body = { messages: [{ role: "user", content: "hi" }] };
    const frame = cursorTextFrame("split-frame-ok");
    const mid = Math.floor(frame.length / 2);

    const { response } = await executor.buildStreamingSseResponse(
      { status: 200, byteStream: webStreamOfChunks([frame.slice(0, mid), frame.slice(mid)]) },
      "http://cursor.invalid/chat", {}, "gpt-5.3-codex", body,
    );
    const text = await response.text();
    expect(text).toContain("split-frame-ok");
    expect(text).toContain("[DONE]");
  });
});

describe("tool-argument fragment merge (incremental scan gate)", () => {
  function createState() {
    return { toolCalls: new Map(), nextBlockIndex: 0 };
  }

  function getInputJsonDelta(events) {
    return events.find((event) => event.type === "content_block_delta" && event.delta?.type === "input_json_delta")?.delta.partial_json;
  }

  it("reassembles an object streamed as thousands of tiny fragments", () => {
    const state = createState();
    const args = { file_path: "F:/repo/big-file.ts", old_string: "a".repeat(2000), new_string: "b".repeat(2000) };
    const raw = JSON.stringify(args);

    openaiToClaudeResponse({
      id: "chatcmpl-frag",
      model: "m",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "toolu_frag", function: { name: "Edit" } }] } }],
    }, state);

    const FRAGMENT_SIZE = 7;
    for (let i = 0; i < raw.length; i += FRAGMENT_SIZE) {
      openaiToClaudeResponse({
        id: "chatcmpl-frag",
        model: "m",
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: raw.slice(i, i + FRAGMENT_SIZE) } }] } }],
      }, state);
    }

    const events = openaiToClaudeResponse({
      id: "chatcmpl-frag",
      model: "m",
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "" } }] }, finish_reason: "tool_calls" }],
    }, state);

    expect(JSON.parse(getInputJsonDelta(events))).toEqual(args);
  });

  it("still merges repeated complete snapshots (provider repeats the object)", () => {
    const state = createState();
    const snapshot = JSON.stringify({ file_path: "F:/repo/doc.pdf", pages: "1-3" });

    openaiToClaudeResponse({
      id: "chatcmpl-snap",
      model: "m",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "toolu_snap", function: { name: "Read", arguments: snapshot } }] } }],
    }, state);
    const events = openaiToClaudeResponse({
      id: "chatcmpl-snap",
      model: "m",
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: snapshot } }] }, finish_reason: "tool_calls" }],
    }, state);

    expect(JSON.parse(getInputJsonDelta(events))).toEqual({ file_path: "F:/repo/doc.pdf", pages: "1-3" });
  });
});

describe("usage write-behind queue", () => {
  const originalDataDir = process.env.DATA_DIR;
  let tempDir;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-usage-wb-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
  });

  afterAll(async () => {
    try {
      const { getAdapterSync } = await import("@/lib/db/driver.js");
      getAdapterSync()?.close?.();
    } catch {}
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("batches fire-and-forget saves; awaiting callers persist immediately", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();

    // Fire-and-forget (thenable never consumed): stays queued.
    db.saveRequestUsage({ provider: "wb-fire", model: "m", tokens: { prompt_tokens: 3, completion_tokens: 1 } });
    await new Promise((r) => setTimeout(r, 100)); // well under the 1.5s batch timer
    expect((await db.getUsageHistory({ provider: "wb-fire" })).length).toBe(0);

    // Explicit flush persists it.
    await db.flushPendingUsage();
    expect((await db.getUsageHistory({ provider: "wb-fire" })).length).toBe(1);

    // Awaiting the returned thenable forces an immediate flush.
    await db.saveRequestUsage({ provider: "wb-await", model: "m", tokens: { prompt_tokens: 2, completion_tokens: 2 } });
    expect((await db.getUsageHistory({ provider: "wb-await" })).length).toBe(1);
  });

  // Regression: the batch timer must be armed at enqueue time. It used to be
  // scheduled only when a caller consumed the thenable, so fire-and-forget
  // saves (the gateway hot path) sat in the queue forever and the dashboard
  // froze on stale usage.
  it("persists fire-and-forget saves via the batch timer alone (no consumer)", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();

    db.saveRequestUsage({ provider: "wb-timer", model: "m", tokens: { prompt_tokens: 5, completion_tokens: 5 } });
    // No .then/.catch/await on the returned thenable — same as chatCore hot path.
    await new Promise((r) => setTimeout(r, 2200)); // > USAGE_WRITE_BEHIND_MS default 1500
    const rows = await db.getUsageHistory({ provider: "wb-timer" });
    expect(rows.length).toBe(1);
  });
});

describe("estimateInputTokens memoization", () => {
  it("computes once per body object and returns a stable value", async () => {
    const { estimateInputTokens } = await import("open-sse/utils/usageTracking.js");
    const body = { messages: [{ role: "user", content: "x".repeat(2000) }], tools: [] };
    const first = estimateInputTokens(body);
    expect(first).toBeGreaterThan(0);
    expect(estimateInputTokens(body)).toBe(first);
    // A different body object recomputes rather than sharing the memo.
    const other = { ...body };
    expect(estimateInputTokens(other)).toBe(first);
  });
});
