// Per-connection usage aggregation regression tests for the provider quota
// cards. These rows intentionally use two WorkBuddy accounts so a dashboard
// refresh can never attribute one account's local history to another.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "switch-router-observed-usage-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("../../src/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("observed usage is isolated by provider connection", () => {
  it("keeps WorkBuddy accounts separate and does not infer native credits", async () => {
    await db.saveRequestUsage({
      provider: "workbuddy",
      model: "deepseek-v4-flash",
      connectionId: "wb-account-a",
      timestamp: "2026-09-11T04:00:00.000Z",
      tokens: { prompt_tokens: 100, completion_tokens: 20, cached_tokens: 10 },
      status: "ok",
    });
    await db.saveRequestUsage({
      provider: "workbuddy",
      model: "deepseek-v4-pro",
      connectionId: "wb-account-b",
      timestamp: "2026-09-11T04:01:00.000Z",
      tokens: { prompt_tokens: 300, completion_tokens: 40, cached_tokens: 30 },
      status: "ok",
    });

    const accountA = await db.getObservedUsageForConnection("wb-account-a", "workbuddy");
    const accountB = await db.getObservedUsageForConnection("wb-account-b", "workbuddy");
    const wrongProvider = await db.getObservedUsageForConnection("wb-account-a", "novita");

    expect(accountA).toMatchObject({
      requests: 1,
      promptTokens: 100,
      completionTokens: 20,
      cachedTokens: 10,
      costUsd: null,
      pricingStatus: "not_applicable",
      lastUsed: "2026-09-11T04:00:00.000Z",
    });
    expect(accountB).toMatchObject({
      requests: 1,
      promptTokens: 300,
      completionTokens: 40,
      cachedTokens: 30,
      costUsd: null,
      pricingStatus: "not_applicable",
    });
    expect(wrongProvider).toMatchObject({ requests: 0, costUsd: 0, pricingStatus: "no_data" });
  });

  it("uses exact Novita pricing for local cost and marks an unknown model unpriced", async () => {
    await db.saveRequestUsage({
      provider: "novita",
      model: "qwen/qwen3.8-flash",
      connectionId: "novita-account-a",
      timestamp: "2026-09-11T04:02:00.000Z",
      tokens: { prompt_tokens: 1000, completion_tokens: 1000, cached_tokens: 200 },
      status: "ok",
    });
    await db.saveRequestUsage({
      provider: "novita",
      model: "vendor/unpriced-model",
      connectionId: "novita-account-b",
      timestamp: "2026-09-11T04:03:00.000Z",
      tokens: { prompt_tokens: 500, completion_tokens: 100 },
      status: "ok",
    });

    const priced = await db.getObservedUsageForConnection("novita-account-a", "novita");
    const unpriced = await db.getObservedUsageForConnection("novita-account-b", "novita");

    expect(priced).toMatchObject({ requests: 1, pricingStatus: "priced" });
    expect(priced.costUsd).toBeCloseTo(0.0005932, 10);
    expect(unpriced).toMatchObject({ requests: 1, costUsd: null, pricingStatus: "unpriced" });
  });
});

