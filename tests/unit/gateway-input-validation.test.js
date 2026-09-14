// Bad client input must never surface as a 500. These cases used to crash deep
// inside the routing helpers (getComboModels calls modelStr.includes, and the
// compact route parsed JSON without a guard), so a client configured with the
// wrong base URL or an unsupported field got an opaque Next.js HTML error page
// instead of a clean 400 — and the HTML made CLI tools look like the gateway
// itself was down.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;

function post(pathname, body, headers = {}) {
  return new Request(`http://127.0.0.1:28701${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "switch-router-input-guard-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  const { initTranslators } = await import("open-sse/translator/index.js");
  await initTranslators();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("gateway input validation", () => {
  it("rejects a missing model with 400 instead of crashing the handler", async () => {
    const { POST } = await import("@/app/api/v1/chat/completions/route.js");
    const res = await POST(post("/v1/chat/completions", JSON.stringify({
      messages: [{ role: "user", content: "hi" }],
    })));
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
    const payload = await res.json();
    expect(JSON.stringify(payload)).toMatch(/model/i);
  });

  it("rejects a non-string model with 400 (used to be modelStr.includes TypeError)", async () => {
    const { POST } = await import("@/app/api/v1/chat/completions/route.js");
    for (const model of [{ nested: "value" }, 123, true, [], ""]) {
      const res = await POST(post("/v1/chat/completions", JSON.stringify({
        model, messages: [{ role: "user", content: "hi" }],
      })));
      expect(res.status, `model=${JSON.stringify(model)}`).toBe(400);
    }
  });

  it("answers malformed JSON with 400 on every chat surface", async () => {
    const { POST } = await import("@/app/api/v1/chat/completions/route.js");
    const res = await POST(post("/v1/chat/completions", '{"model":'));
    expect(res.status).toBe(400);
  });

  it("answers malformed JSON with 400 on the compact route", async () => {
    const { POST } = await import("@/app/api/v1/responses/compact/route.js");
    const res = await POST(post("/v1/responses/compact", "not json at all"));
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("answers a malformed JSON body on the Anthropic Messages surface with 400", async () => {
    const { POST } = await import("@/app/api/v1/messages/route.js");
    const res = await POST(post("/v1/messages", '{"model":'));
    expect(res.status).toBe(400);
  });
});
