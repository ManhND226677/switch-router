import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

describe("performance helpers", () => {
  describe("quota fetch cache", () => {
    let cache;

    beforeEach(async () => {
      vi.resetModules();
      delete global.__quotaFetchCache;
      cache = await import("../../src/shared/services/quotaFetchCache.js");
    });

    it("coalesces concurrent loads and supports an explicit force refresh", async () => {
      let resolveFirst;
      const loader = vi.fn()
        .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
        .mockResolvedValueOnce({ value: "fresh" });

      const first = cache.getCachedQuotaUsage("quota:test", loader);
      const second = cache.getCachedQuotaUsage("quota:test", loader);
      await Promise.resolve();
      expect(loader).toHaveBeenCalledTimes(1);

      resolveFirst({ value: "cached" });
      await expect(Promise.all([first, second])).resolves.toEqual([
        { value: "cached" },
        { value: "cached" },
      ]);

      await expect(cache.getCachedQuotaUsage("quota:test", loader)).resolves.toEqual({ value: "cached" });
      await expect(cache.getCachedQuotaUsage("quota:test", loader, { force: true })).resolves.toEqual({ value: "fresh" });
      expect(loader).toHaveBeenCalledTimes(2);
    });
  });

  describe("async request logger", () => {
    const previousLogging = process.env.ENABLE_REQUEST_LOGS;
    const sessions = [];
    let loggerModule;

    beforeEach(async () => {
      process.env.ENABLE_REQUEST_LOGS = "true";
      vi.resetModules();
      delete global.__requestLoggerState;
      loggerModule = await import("../../open-sse/utils/requestLogger.js");
    });

    afterEach(async () => {
      for (const session of sessions.splice(0, sessions.length)) {
        await fs.rm(session, { recursive: true, force: true });
      }
      if (previousLogging === undefined) delete process.env.ENABLE_REQUEST_LOGS;
      else process.env.ENABLE_REQUEST_LOGS = previousLogging;
    });

    it("preserves chunk order and flushes all files on close", async () => {
      const logger = await loggerModule.createRequestLogger("openai", "claude", "test-model");
      sessions.push(logger.sessionPath);

      logger.appendProviderChunk("provider-1");
      logger.appendProviderChunk("provider-2");
      logger.appendOpenAIChunk("openai-1");
      logger.appendConvertedChunk("client-1");
      logger.logRawRequest({ message: "request" });
      await logger.close();

      await expect(fs.readFile(path.join(logger.sessionPath, "5_res_provider.txt"), "utf8"))
        .resolves.toBe("provider-1provider-2");
      await expect(fs.readFile(path.join(logger.sessionPath, "6_res_openai.txt"), "utf8"))
        .resolves.toBe("openai-1");
      await expect(fs.readFile(path.join(logger.sessionPath, "7_res_client.txt"), "utf8"))
        .resolves.toBe("client-1");
      await expect(fs.readFile(path.join(logger.sessionPath, "2_req_source.json"), "utf8"))
        .resolves.toContain('"message": "request"');
    });
  });

  describe("console buffer", () => {
    let consoleModule;
    let originals;

    beforeEach(async () => {
      vi.resetModules();
      delete global._consoleLogBufferState;
      originals = Object.fromEntries(["log", "info", "warn", "error", "debug"].map((level) => [level, console[level]]));
      consoleModule = await import("../../src/lib/consoleLogBuffer.js");
      consoleModule.initConsoleLogCapture();
    });

    afterEach(() => {
      for (const [level, original] of Object.entries(originals)) console[level] = original;
      delete global._consoleLogBufferState;
    });

    it("clears pending batched lines without resurrecting them", async () => {
      console.log("pending-console-line");
      consoleModule.clearConsoleLogs();
      await new Promise((resolve) => setTimeout(resolve, 130));
      expect(consoleModule.getConsoleLogs()).not.toContain("pending-console-line");
    });
  });
});
