// Regression tests for the routing hot-path latency optimizations:
//  1. Sticky-RR write-behind queue (no per-request DB write / cache wipe)
//  2. updateProviderConnectionsBatch single-transaction merge
//  3. Virtual-key + proxy-pool hot caches with write invalidation
//  4. Capabilities/pricing memoization + precompiled glob regexes
//  5. RoutingEngine deadline budget + attempts on success results
//  6. Shorter timeout/retry defaults
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-routing-latency-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
});

afterAll(async () => {
  // Release the SQLite handle so temp-dir cleanup works on Windows (EPERM otherwise)
  try {
    const { getAdapterSync } = await import("@/lib/db/driver.js");
    getAdapterSync()?.close?.();
  } catch {}
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("connections list cache + batched RR persist", () => {
  it("updateProviderConnectionsBatch merges many rows and invalidates the list cache once", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    const a = await db.createProviderConnection({ provider: "testprov", authType: "apikey", name: "A", apiKey: "sk-a" });
    const b = await db.createProviderConnection({ provider: "testprov", authType: "apikey", name: "B", apiKey: "sk-b" });

    // Prime the 1s list cache
    await db.getProviderConnections({ provider: "testprov", isActive: true });

    const touched = await db.updateProviderConnectionsBatch({
      [a.id]: { lastUsedAt: "2026-01-01T00:00:00.000Z", consecutiveUseCount: 2 },
      [b.id]: { lastUsedAt: "2026-01-02T00:00:00.000Z", consecutiveUseCount: 1 },
      "missing-id": { lastUsedAt: "2026-01-02T00:00:00.000Z", consecutiveUseCount: 1 },
    });
    expect(touched).toBe(2); // missing row skipped, no throw

    // Cache was invalidated → fresh read sees the new counters
    const conns = await db.getProviderConnections({ provider: "testprov", isActive: true });
    expect(conns.find((c) => c.id === a.id).consecutiveUseCount).toBe(2);

    // Other fields (model locks) survive the batch merge
    await db.updateProviderConnection(a.id, { modelLock_someModel: new Date(Date.now() + 60_000).toISOString() });
    await db.updateProviderConnectionsBatch({ [a.id]: { lastUsedAt: "2026-01-03T00:00:00.000Z", consecutiveUseCount: 3 } });
    const after = (await db.getProviderConnections({ provider: "testprov", isActive: true })).find((c) => c.id === a.id);
    expect(after.consecutiveUseCount).toBe(3);
    expect(after.modelLock_someModel).toBeTruthy();
  });

  it("round-robin counters stay in memory until flush — no DB write per request", async () => {
    const db = await import("@/lib/db/index.js");
    const auth = await import("@/sse/services/auth.js");
    await db.updateSettings({ fallbackStrategy: "round-robin" });
    try {
      const conn = await db.createProviderConnection({ provider: "rrprov", authType: "apikey", name: "R1", apiKey: "sk-r1" });
      await db.createProviderConnection({ provider: "rrprov", authType: "apikey", name: "R2", apiKey: "sk-r2" });

      const c1 = await auth.getProviderCredentials("rrprov", null, "some-model");
      const c2 = await auth.getProviderCredentials("rrprov", null, "some-model");
      expect(c1).toBeTruthy();
      expect(c2).toBeTruthy();

      // Selection happened (in-memory counters updated) but the DB row is untouched
      const row = await db.getProviderConnectionById(conn.id);
      expect(row.consecutiveUseCount ?? 0).toBe(0);

      // Explicit flush persists the queued counters in one batch
      await auth.flushRrCounters();
      const rowAfter = await db.getProviderConnectionById(conn.id);
      expect(rowAfter.consecutiveUseCount).toBeGreaterThanOrEqual(1);
      expect(rowAfter.lastUsedAt).toBeTruthy();
    } finally {
      await db.updateSettings({ fallbackStrategy: "fill-first" });
    }
  });
});

describe("virtual-key + proxy-pool hot caches", () => {
  it("validateApiKey/getApiKeyByKey cache reads and invalidate on writes", async () => {
    const db = await import("@/lib/db/index.js");
    const key = await db.createApiKey("t1", "machine-1");
    expect(await db.validateApiKey(key.key)).toBe(true);
    expect((await db.getApiKeyByKey(key.key)).name).toBe("t1");

    // Deactivation must be visible immediately (cache invalidated by updateApiKey)
    await db.updateApiKey(key.id, { isActive: false });
    expect(await db.validateApiKey(key.key)).toBe(false);
    expect((await db.getApiKeyByKey(key.key)).isActive).toBe(false);

    // Unknown keys are cached as invalid but creation invalidates the entry
    expect(await db.validateApiKey("sk-nonexistent")).toBe(false);
    await db.deleteApiKey(key.id);
    expect(await db.getApiKeyByKey(key.key)).toBeNull();
  });

  it("getProxyPoolById serves the by-id cache and invalidates on write/delete", async () => {
    const db = await import("@/lib/db/index.js");
    const pool = await db.createProxyPool({ name: "p1", proxyUrl: "http://127.0.0.1:7890", type: "http" });
    expect((await db.getProxyPoolById(pool.id)).name).toBe("p1");

    await db.updateProxyPool(pool.id, { name: "p1-renamed" });
    expect((await db.getProxyPoolById(pool.id)).name).toBe("p1-renamed");

    await db.deleteProxyPool(pool.id);
    expect(await db.getProxyPoolById(pool.id)).toBeNull();
  });
});

describe("capabilities/pricing memoization", () => {
  it("getCapabilitiesForModel memoizes but always returns a fresh copy", async () => {
    const { getCapabilitiesForModel } = await import("open-sse/providers/capabilities.js");
    const a = getCapabilitiesForModel("anthropic", "claude-sonnet-4.6");
    const b = getCapabilitiesForModel("anthropic", "claude-sonnet-4.6");
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // callers may mutate the result

    // Mutating one result must not poison the memo
    a.reasoning = false;
    expect(getCapabilitiesForModel("anthropic", "claude-sonnet-4.6").reasoning).not.toBe(false);
  });

  it("matchPattern keeps glob semantics with precompiled regexes", async () => {
    const { matchPattern } = await import("open-sse/providers/pricing.js");
    expect(matchPattern("grok-code-*", "grok-code-fast-1")).toBe(true);
    expect(matchPattern("grok-code-*", "grok-3")).toBe(false);
    expect(matchPattern("grok-*", "grok-3")).toBe(true);
    expect(matchPattern("MiniMax-*", "minimax-m2.5")).toBe(true); // case-insensitive
    expect(matchPattern("*step-*", "gemini-2.5-step-1")).toBe(true);
    // Repeated calls hit the compiled-regex cache and stay consistent
    expect(matchPattern("grok-*", "grok-4")).toBe(matchPattern("grok-*", "grok-4"));
  });

  it("getPricingForModel memoizes lookups consistently", async () => {
    const { getPricingForModel } = await import("open-sse/providers/pricing.js");
    const p1 = getPricingForModel(null, "deepseek-chat");
    const p2 = getPricingForModel(null, "deepseek-chat");
    expect(p1).toBe(p2); // table objects were already shared refs before memoization
    expect(p1).toBeTruthy();
  });
});

describe("RoutingEngine deadline budget", () => {
  it("stops starting new attempts once the deadline is exceeded", async () => {
    const { RoutingEngine } = await import("@/core/routing/routingEngine.js");
    let attempts = 0;
    const engine = new RoutingEngine({
      maxAttempts: 10,
      deadlineMs: 80,
      // Distinct id per call so no candidate is ever "already excluded"
      resolveCredentials: ({ attempts: n }) => ({ connectionId: `c${n}` }),
      executeAttempt: async () => {
        attempts++;
        await new Promise((r) => setTimeout(r, 50));
        return { success: false, status: 502 };
      },
      onFailure: async () => ({ shouldFallback: true }),
    });
    const result = await engine.execute({ provider: "p", model: "m" });
    expect(attempts).toBeGreaterThanOrEqual(1);
    expect(attempts).toBeLessThan(10);
    expect(result.success).toBe(false);
    expect(result.deadlineExceeded).toBe(true);
    expect(result.attempts).toBe(attempts);
  });

  it("deadline=0 (default) keeps the full maxAttempts loop", async () => {
    const { RoutingEngine } = await import("@/core/routing/routingEngine.js");
    let attempts = 0;
    const engine = new RoutingEngine({
      maxAttempts: 3,
      resolveCredentials: ({ attempts: n }) => ({ connectionId: `c${n}` }),
      executeAttempt: async () => { attempts++; return { success: false }; },
      onFailure: async () => ({ shouldFallback: true }),
    });
    const result = await engine.execute({});
    expect(attempts).toBe(3);
    expect(result.outcome).toBe("unavailable");
  });

  it("attaches attempts to successful results", async () => {
    const { RoutingEngine } = await import("@/core/routing/routingEngine.js");
    let n = 0;
    const engine = new RoutingEngine({
      resolveCredentials: () => ({ connectionId: "c" }),
      executeAttempt: async () => { n++; return n < 2 ? { success: false } : { success: true, response: "R" }; },
      onFailure: async () => ({ shouldFallback: true }),
    });
    const result = await engine.execute({});
    expect(result.success).toBe(true);
    expect(result.response).toBe("R");
    expect(result.attempts).toBe(2);
  });
});

describe("timeout/retry defaults", () => {
  it("uses the tightened latency-oriented defaults", async () => {
    const cfg = await import("open-sse/config/runtimeConfig.js");
    expect(cfg.FETCH_CONNECT_TIMEOUT_MS).toBe(15_000);
    expect(cfg.STREAM_FIRST_CHUNK_TIMEOUT_MS).toBe(90_000);
    expect(cfg.DEFAULT_RETRY_CONFIG[502].attempts).toBe(2);
    expect(cfg.DEFAULT_RETRY_CONFIG[503].delayMs).toBeLessThan(2000);
    expect(cfg.DEFAULT_RETRY_CONFIG[504].attempts).toBe(1);
    expect(cfg.DEFAULT_RETRY_CONFIG[429].attempts).toBe(0);
  });
});
