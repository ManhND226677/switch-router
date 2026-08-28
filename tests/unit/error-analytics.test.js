// /api/usage/errors used to hand-roll SQL through db.prepare(), which no
// adapter in the driver chain exposes (they offer run/get/all/exec/transaction),
// so the endpoint answered 500 for every request and the Error Analytics page
// was dead end to end. Aggregation now lives in requestDetailsRepo — these
// tests pin the shapes the page reads.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let adapter;
let getErrorAnalytics;

function insertDetail({ id, timestamp, provider, model, status, data }) {
  adapter.run(
    `INSERT INTO requestDetails (id, timestamp, provider, model, connectionId, status, data)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, timestamp, provider, model, "conn-1", status, JSON.stringify(data)]
  );
}

const errorData = (status, message, totalMs = 1000) => ({
  status: "error",
  latency: { ttft: 0, total: totalMs },
  // Real writers store the upstream envelope as a JSON *string*.
  response: status == null
    ? { error: message, status: null }
    : { error: JSON.stringify({ error: { message } }), status },
});

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "switch-router-error-analytics-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  const db = await import("../../src/lib/db/index.js");
  await db.initDb();
  getErrorAnalytics = db.getErrorAnalytics;
  const { getAdapter } = await import("@/lib/db/driver.js");
  adapter = await getAdapter();

  insertDetail({ id: "ok-1", timestamp: "2026-08-27T01:00:00.000Z", provider: "openrouter", model: "glm-5", status: "success", data: { status: "success", latency: { ttft: 100, total: 900 } } });
  insertDetail({ id: "ok-2", timestamp: "2026-08-27T02:00:00.000Z", provider: "antigravity", model: "claude-sonnet-5", status: "success", data: { status: "success", latency: { ttft: 120, total: 800 } } });
  insertDetail({ id: "e-1", timestamp: "2026-08-27T03:00:00.000Z", provider: "antigravity", model: "claude-sonnet-5", status: "error", data: errorData(429, "Resource has been exhausted (e.g. check quota).", 34000) });
  insertDetail({ id: "e-2", timestamp: "2026-08-27T04:00:00.000Z", provider: "antigravity", model: "claude-sonnet-5", status: "error", data: errorData(429, "Resource has been exhausted (e.g. check quota).", 32000) });
  // Plain (non-JSON) error text: json_extract must not blow up on it.
  insertDetail({ id: "e-3", timestamp: "2026-08-26T05:00:00.000Z", provider: "openrouter", model: "glm-5", status: "error", data: errorData(null, "fetch connect timeout", 5000) });
  // A row whose status column never got written still has to show up as a failure.
  insertDetail({ id: "e-4", timestamp: "2026-08-26T06:00:00.000Z", provider: "openrouter", model: "glm-5", status: null, data: { latency: { total: 10 } } });
});

afterAll(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("getErrorAnalytics", () => {
  it("counts failures against all requests and reports a success rate", async () => {
    const { totals } = await getErrorAnalytics({});
    expect(totals.totalRequests).toBe(6);
    expect(totals.totalErrors).toBe(4);
    expect(totals.successRate).toBe(33.3);
    expect(totals.errorLatencyMs).toBe(71010);
  });

  it("groups by provider+model by default and honours groupBy", async () => {
    const byPair = await getErrorAnalytics({});
    expect(byPair.groupBy).toBe("provider:model");
    expect(byPair.byGroup[0]).toMatchObject({ provider: "antigravity", model: "claude-sonnet-5", errors: 2 });

    const byProvider = await getErrorAnalytics({ groupBy: "provider" });
    expect(byProvider.byGroup).toHaveLength(2);
    expect(byProvider.byGroup[0]).toMatchObject({ provider: "antigravity", errors: 2 });
    expect(byProvider.byGroup[0].model).toBeUndefined();

    // Unknown groupBy degrades to the default instead of failing.
    expect((await getErrorAnalytics({ groupBy: "bogus" })).groupBy).toBe("provider:model");
  });

  it("collapses repeated upstream messages into signatures with their status", async () => {
    const { signatures } = await getErrorAnalytics({});
    const top = signatures[0];
    expect(top).toMatchObject({ status: 429, count: 2 });
    // Unwrapped out of the JSON envelope, not the raw multi-line blob.
    expect(top.message).toBe("Resource has been exhausted (e.g. check quota).");
    expect(signatures.some((s) => s.message === "fetch connect timeout")).toBe(true);
  });

  it("returns recent failures newest first without the multi-KB payload", async () => {
    const { recent } = await getErrorAnalytics({ recentLimit: 2 });
    expect(recent).toHaveLength(2);
    expect(recent[0].id).toBe("e-2");
    expect(recent[0]).toMatchObject({ provider: "antigravity", statusCode: 429, totalMs: 32000 });
    expect(recent[0].data).toBeUndefined();
  });

  it("includes the whole endDate day for date-only bounds", async () => {
    // Regression: toValidDateIso("2026-08-27") is midnight, so an inclusive
    // upper bound silently dropped every request of the day the user picked.
    const oneDay = await getErrorAnalytics({ startDate: "2026-08-27", endDate: "2026-08-27" });
    expect(oneDay.totals.totalRequests).toBe(4);
    expect(oneDay.totals.totalErrors).toBe(2);
    expect(oneDay.period).toEqual({
      startDate: "2026-08-27T00:00:00.000Z",
      endDate: "2026-08-27T23:59:59.999Z",
    });

    const previousDay = await getErrorAnalytics({ startDate: "2026-08-26", endDate: "2026-08-26" });
    expect(previousDay.totals.totalErrors).toBe(2);
  });

  it("clamps recentLimit and tolerates an unparseable date", async () => {
    expect((await getErrorAnalytics({ recentLimit: 9999 })).recent.length).toBeLessThanOrEqual(100);
    const garbage = await getErrorAnalytics({ startDate: "not-a-date" });
    expect(garbage.period.startDate).toBeNull();
    expect(garbage.totals.totalErrors).toBe(4);
  });
});
