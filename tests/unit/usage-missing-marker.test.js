// A request the gateway could not measure must be marked, not silently stored
// as a 0-token one — and the field the gateway now sends to ask upstreams for
// usage must stay opt-out-able, because an upstream that validates its schema
// strictly would answer 400 rather than ignore it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

describe("usage-missing marker and stream usage request", () => {
  const originalDataDir = process.env.DATA_DIR;
  const originalStreamUsage = process.env.SWITCH_ROUTER_STREAM_USAGE;
  let tempDir;
  let requestDetail;
  let defaultExecutor;
  let DefaultExecutor;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sr-usage-missing-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
    requestDetail = await import("../../open-sse/handlers/chatCore/requestDetail.js");
    defaultExecutor = await import("../../open-sse/executors/default.js");
    DefaultExecutor = defaultExecutor.DefaultExecutor;
  });

  afterAll(async () => {
    try {
      const { getAdapterSync } = await import("@/lib/db/driver.js");
      getAdapterSync()?.close?.();
    } catch { /* driver may not have loaded */ }
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    if (originalStreamUsage === undefined) delete process.env.SWITCH_ROUTER_STREAM_USAGE;
    else process.env.SWITCH_ROUTER_STREAM_USAGE = originalStreamUsage;
  });

  describe("isUsageMissing", () => {
    it("is true when there is nothing to measure", () => {
      expect(requestDetail.isUsageMissing(null)).toBe(true);
      expect(requestDetail.isUsageMissing(undefined)).toBe(true);
      expect(requestDetail.isUsageMissing({})).toBe(true);
      expect(requestDetail.isUsageMissing({ prompt_tokens: 0, completion_tokens: 0 })).toBe(true);
      expect(requestDetail.isUsageMissing({ input_tokens: 0, output_tokens: 0 })).toBe(true);
    });

    it("is false as soon as either side was measured", () => {
      expect(requestDetail.isUsageMissing({ prompt_tokens: 753, completion_tokens: 0 })).toBe(false);
      expect(requestDetail.isUsageMissing({ prompt_tokens: 0, completion_tokens: 16 })).toBe(false);
      expect(requestDetail.isUsageMissing({ input_tokens: 753, output_tokens: 16 })).toBe(false);
    });

    it("reads both the OpenAI and the Claude token naming", () => {
      expect(requestDetail.isUsageMissing({ prompt_tokens: 5, completion_tokens: 0 })).toBe(false);
      expect(requestDetail.isUsageMissing({ input_tokens: 5, output_tokens: 0 })).toBe(false);
      // The format-specific key wins when present, even at 0 — a provider that
      // explicitly reports zero measured nothing, so it stays "missing".
      expect(requestDetail.isUsageMissing({ input_tokens: 0, output_tokens: 0, prompt_tokens: 5 })).toBe(true);
    });
  });

  describe("buildRequestDetail", () => {
    it("omits the marker when usage was captured", () => {
      const detail = requestDetail.buildRequestDetail({
        provider: "kilocode",
        model: "m",
        tokens: { prompt_tokens: 753, completion_tokens: 16 },
      });
      expect(detail.usageMissing).toBeUndefined();
      expect("usageMissing" in detail).toBe(false);
    });

    it("carries the marker through when the caller flags it", () => {
      const detail = requestDetail.buildRequestDetail({
        provider: "kilocode",
        model: "m",
        tokens: { prompt_tokens: 0, completion_tokens: 0 },
        usageMissing: true,
      });
      expect(detail.usageMissing).toBe(true);
    });

    it("does not flag the streaming placeholder row on its own", () => {
      // The row written while the stream is still in flight is 0/0 by
      // construction; flagging it would mark every streaming request.
      const detail = requestDetail.buildRequestDetail({
        provider: "kilocode",
        model: "m",
        tokens: { prompt_tokens: 0, completion_tokens: 0 },
      });
      expect(detail.usageMissing).toBeUndefined();
    });
  });

  describe("stream_options request", () => {
    function body(stream = true) {
      return { model: "nex-agi/nex-n2.5-pro:free", stream, messages: [{ role: "user", content: "hi" }] };
    }

    it("asks an OpenAI-format streaming upstream for usage", () => {
      const exec = new DefaultExecutor("kilocode");
      const out = exec.transformRequest("nex-agi/nex-n2.5-pro:free", body(true), true, {});
      expect(out.stream_options).toEqual({ include_usage: true });
    });

    it("leaves non-streaming requests alone", () => {
      const exec = new DefaultExecutor("kilocode");
      const out = exec.transformRequest("m", body(false), false, {});
      expect(out.stream_options).toBeUndefined();
    });

    it("skips wire formats that have no stream_options contract", () => {
      const exec = new DefaultExecutor("claude");
      const out = exec.transformRequest("claude-sonnet-5", body(true), true, {});
      expect(out.stream_options).toBeUndefined();
    });

    it("keeps caller-supplied stream_options", () => {
      const exec = new DefaultExecutor("kilocode");
      const b = body(true);
      b.stream_options = { some_flag: true };
      const out = exec.transformRequest("m", b, true, {});
      expect(out.stream_options).toEqual({ some_flag: true, include_usage: true });
    });

    it("is switched off entirely by SWITCH_ROUTER_STREAM_USAGE=off", () => {
      process.env.SWITCH_ROUTER_STREAM_USAGE = "off";
      try {
        expect(defaultExecutor.streamUsageRequestDisabled()).toBe(true);
        const exec = new DefaultExecutor("kilocode");
        const out = exec.transformRequest("m", body(true), true, {});
        expect(out.stream_options).toBeUndefined();
      } finally {
        delete process.env.SWITCH_ROUTER_STREAM_USAGE;
      }
    });

    it("still runs the param-strip pass afterwards, so a per-provider opt-out wins", () => {
      // STRIP_RULES drops `temperature` for any claude model. Seeing it removed
      // from the same body that just received stream_options proves strip runs
      // AFTER the injection — which is what makes
      // `{ provider: "x", drop: ["stream_options"] }` a working opt-out.
      const exec = new DefaultExecutor("kilocode");
      const b = body(true);
      b.temperature = 0.7;
      const out = exec.transformRequest("claude-sonnet-4-20250514", b, true, {});
      expect(out.temperature).toBeUndefined();
      expect(out.stream_options).toEqual({ include_usage: true });
    });
  });
});
