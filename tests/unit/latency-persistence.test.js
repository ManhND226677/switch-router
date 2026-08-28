// The "fastest" strategy used to keep its EWMA purely in memory, so every
// restart lost all routing learning and ran on priority order until traffic
// re-seeded it. These tests pin the write-behind persist + hydrate round-trip
// and the pruning of entries a dead connection left behind.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

async function freshLatencyModule() {
  vi.resetModules();
  delete global._connectionLatencyEwma;
  return import("../../open-sse/services/connectionLatency.js");
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "switch-router-latency-"));
  process.env.DATA_DIR = tempDir;
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

beforeEach(async () => {
  const { writeLatencySnapshots } = await import("../../src/lib/db/repos/connectionLatencyRepo.js");
  await writeLatencySnapshots({});
});

describe("connection latency persistence", () => {
  it("restores a persisted EWMA after a restart-shaped reload", async () => {
    const { recordConnectionLatency, flushConnectionLatency } = await freshLatencyModule();
    for (let i = 0; i < 3; i++) recordConnectionLatency("conn-a", 400, 900);
    recordConnectionLatency("conn-b", null, 5000); // non-streaming → total only
    expect(await flushConnectionLatency()).toBe(2);

    // Simulate a process restart: brand-new module state, same database.
    const reloaded = await freshLatencyModule();
    expect(reloaded.getConnectionLatencySnapshot("conn-a")).toBeNull(); // before hydrate
    expect(await reloaded.hydrateConnectionLatency()).toBe(2);

    const a = reloaded.getConnectionLatencySnapshot("conn-a");
    expect(a.ewmaTtftMs).toBe(400);
    expect(a.samples).toBe(3);
    expect(a.scoreMs).toBe(400);
    // conn-b was only ever seen non-streaming: biased slow on purpose, and it
    // still scores so ranking against conn-a stays meaningful.
    const b = reloaded.getConnectionLatencySnapshot("conn-b");
    expect(b.ewmaTtftMs).toBeNull();
    expect(b.scoreMs).toBe(5000);
    expect(reloaded.pickFastestConnection([{ id: "conn-a", priority: 1 }, { id: "conn-b", priority: 0 }]).id).toBe("conn-a");
  });

  it("hydrate is idempotent and a live sample always wins over the stored one", async () => {
    const writer = await freshLatencyModule();
    writer.recordConnectionLatency("conn-c", 300, 300);
    expect(await writer.flushConnectionLatency()).toBe(1);

    // Restoring into a fresh instance counts as a real load…
    const reader = await freshLatencyModule();
    expect(await reader.hydrateConnectionLatency()).toBe(1);
    expect(await reader.hydrateConnectionLatency(), "second call must be a no-op").toBe(0);

    // …but an entry already measured in this process is never overwritten.
    const live = await freshLatencyModule();
    live.recordConnectionLatency("conn-c", 9000, 9000);
    expect(await live.hydrateConnectionLatency()).toBe(0);
    expect(live.getConnectionLatencySnapshot("conn-c").ewmaTtftMs).toBe(9000);
  });

  it("drops persisted entries older than a day", async () => {
    const { writeLatencySnapshots, readLatencySnapshots } = await import("../../src/lib/db/repos/connectionLatencyRepo.js");
    await writeLatencySnapshots({
      ancient: { ewmaTtftMs: 10, ewmaTotalMs: 10, samples: 5, lastSampleAt: Date.now() - 25 * 60 * 60 * 1000 },
      recent: { ewmaTtftMs: 20, ewmaTotalMs: 20, samples: 2, lastSampleAt: Date.now() - 60 * 1000 },
      broken: null,
    });
    const { hydrateConnectionLatency, getConnectionLatencySnapshot } = await freshLatencyModule();
    expect(await hydrateConnectionLatency()).toBe(1);
    expect(getConnectionLatencySnapshot("ancient")).toBeNull();
    expect(getConnectionLatencySnapshot("recent").scoreMs).toBe(20);
    // The repo is a faithful store; dropping junk is the hydrator's job above.
    expect(Object.keys(await readLatencySnapshots()).sort()).toEqual(["ancient", "broken", "recent"]);
  });

  it("writing an empty map clears the stored row", async () => {
    const { writeLatencySnapshots, readLatencySnapshots } = await import("../../src/lib/db/repos/connectionLatencyRepo.js");
    await writeLatencySnapshots({ a: { ewmaTtftMs: 1, ewmaTotalMs: 1, samples: 1, lastSampleAt: Date.now() } });
    expect(await writeLatencySnapshots({})).toBe(0);
    expect(await readLatencySnapshots()).toEqual({});
  });
});

describe("cache savings in money", () => {
  async function seedAndRead(tokens, provider = "claude", model = "claude-sonnet-5") {
    await db.saveRequestUsage({
      provider, model, connectionId: "c1", endpoint: "/v1/chat/completions",
      status: "ok", tokens, cost: 0, timestamp: new Date().toISOString(),
    });
    await db.flushPendingUsage();
    return db.getCacheStats("7d");
  }

  // getCacheStats aggregates every row in the window, and both cases share this
  // temp DB — assert on the per-model bucket (keyed `provider|model`) so each
  // case only looks at the rows it seeded.
  const modelBucket = (stats, model) => stats.models.find((m) => m.model === model);

  it("prices the cache discount from the model's cached vs input rate", async () => {
    const pricing = (await import("../../open-sse/providers/pricing.js")).getPricingForModel("claude", "claude-sonnet-5");
    expect(pricing?.input).toBeGreaterThan(0);

    const stats = await seedAndRead({
      prompt_tokens: 100_000, completion_tokens: 1_000, total_tokens: 101_000,
      cached_tokens: 80_000,
    }, "claude", "claude-sonnet-5");
    const expected = (80_000 * (pricing.input - (pricing.cached ?? pricing.input))) / 1e6;
    expect(modelBucket(stats, "claude-sonnet-5").savedUsd).toBeCloseTo(expected, 6);
  });

  it("yields no saving for a model with no pricing entry", async () => {
    const stats = await seedAndRead(
      { prompt_tokens: 50_000, completion_tokens: 10, total_tokens: 50_010, cached_tokens: 50_000 },
      "claude", "unlisted-model-9000");
    const bucket = modelBucket(stats, "unlisted-model-9000");
    expect(bucket.cachedTokens).toBe(50_000);
    expect(bucket.savedUsd).toBe(0);
  });
});
