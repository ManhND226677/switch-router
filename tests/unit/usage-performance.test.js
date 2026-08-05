import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("usage performance paths", () => {
  const originalDataDir = process.env.DATA_DIR;
  let tempDir;
  let db;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "switch-router-usage-performance-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
    db = await import("@/lib/db/index.js");
    await db.initDb();
  });

  afterAll(() => {
    try { global._dbAdapter?.instance?.close?.(); } catch {}
    delete global._dbAdapter;
    delete global._usageStatsCache;
    delete global._usageChartCache;
    delete global._usageReferenceCache;
    delete global._usageDailyLastUsedState;
    delete global._latestUsageIdState;
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("uses precise daily lastUsed and cursor-based request logs", async () => {
    const entries = [
      "2026-01-01T12:00:00.000Z",
      "2026-01-01T12:00:01.000Z",
      "2026-01-01T12:00:02.000Z",
    ];

    for (const timestamp of entries) {
      await db.saveRequestUsage({
        timestamp,
        provider: "openai",
        model: "gpt-4",
        connectionId: "account-1",
        tokens: { prompt_tokens: 2, completion_tokens: 1 },
        status: "ok",
      });
    }

    const first = await db.getUsageStats("all");
    const second = await db.getUsageStats("all");
    expect(second).toBe(first);
    expect(first.byModel["gpt-4 (openai)"].lastUsed).toBe(entries[2]);
    expect((await db.getUsageHistory({ provider: "openai" })).length).toBe(3);

    const page = await db.getRecentLogsPage(10, { afterId: 1 });
    expect(page.logs).toHaveLength(2);
    expect(page.cursorId).toBe(3);
    expect(page.reset).toBe(false);
  });
});
