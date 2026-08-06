// Regression guards for the 2026-08-05 data-repair work (P0/P2/P3/P4).
// Each test pins a defect that was found in real data, so a future change that
// re-introduces it fails here instead of silently corrupting the local store.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
const originalObsEnv = process.env.OBSERVABILITY_ENABLED;
let tempDir;
let db;
let adapter;

// A key shaped exactly like the real ones: sk-{machineId16}-{keyId}-{crc8}.
// The first 8 chars are shared by every key on a machine, which is the whole
// reason a plain slice(0,8) mask is not enough.
const KEY_A = "sk-07ee777358ca6609-qyul5j-03b38c14";
const KEY_B = "sk-07ee777358ca6609-zzzz99-ffffffff";

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "switch-router-data-repair-"));
  process.env.DATA_DIR = tempDir;
  delete process.env.OBSERVABILITY_ENABLED;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  const { getAdapter } = await import("@/lib/db/driver.js");
  adapter = await getAdapter();
});

afterAll(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalObsEnv === undefined) delete process.env.OBSERVABILITY_ENABLED;
  else process.env.OBSERVABILITY_ENABLED = originalObsEnv;
});

// ───────────────────────────────────────────────────────────────────────────
// P0 — a usable gateway key must never reach disk
// ───────────────────────────────────────────────────────────────────────────
describe("P0: gateway API key is never persisted in plaintext", () => {
  it("saveRequestUsage stores a fingerprint, not the raw key", async () => {
    await db.saveRequestUsage({
      provider: "openai", model: "gpt-4", connectionId: "conn-a", apiKey: KEY_A,
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      endpoint: "/v1/chat/completions", status: "ok",
    });

    const rows = adapter.all(`SELECT apiKey FROM usageHistory`);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.apiKey).not.toBe(KEY_A);
      expect(r.apiKey).toContain("***");
    }
  });

  it("the raw key does not appear anywhere in the DB file", async () => {
    adapter.checkpoint?.();
    const dbFile = path.join(tempDir, "db", "data.sqlite");
    const blob = fs.readFileSync(dbFile).toString("latin1");
    // The apiKeys table legitimately stores real keys; we only created usage
    // rows here, so the gateway key must be absent entirely.
    expect(blob).not.toContain(KEY_A);
  });

  it("usageDaily rollup holds no plaintext key in bucket key or meta", async () => {
    const { isFingerprinted } = await import("@/lib/db/helpers/apiKeyPrivacy.js");
    const rows = adapter.all(`SELECT data FROM usageDaily`);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const day = JSON.parse(row.data);
      for (const [bucketKey, bucket] of Object.entries(day.byApiKey || {})) {
        const rawSegment = String(bucketKey).split("|")[0];
        expect(rawSegment).not.toBe(KEY_A);
        if (rawSegment !== "local-no-key") expect(isFingerprinted(rawSegment)).toBe(true);
        if (bucket?.meta?.apiKey) expect(isFingerprinted(bucket.meta.apiKey)).toBe(true);
      }
    }
  });

  it("two keys sharing the same 8-char prefix stay in separate buckets", async () => {
    // Regression: masking to slice(0,8) alone maps every key on one machine to
    // "sk-07ee***", merging unrelated traffic into a single usage bucket.
    const { fingerprintApiKey } = await import("@/lib/db/helpers/apiKeyPrivacy.js");
    expect(KEY_A.slice(0, 8)).toBe(KEY_B.slice(0, 8));
    expect(fingerprintApiKey(KEY_A)).not.toBe(fingerprintApiKey(KEY_B));
  });

  it("fingerprinting is idempotent and unusable as a credential", async () => {
    const { fingerprintApiKey } = await import("@/lib/db/helpers/apiKeyPrivacy.js");
    const once = fingerprintApiKey(KEY_A);
    expect(fingerprintApiKey(once)).toBe(once);
    // The keyId segment that authenticates the key must be gone.
    expect(once).not.toContain("qyul5j");
    expect(once.length).toBeLessThan(KEY_A.length);
  });

  it("a fingerprinted key still resolves to its human-readable name", async () => {
    // apiKeyMap is keyed by the stored value; if only the raw key were indexed
    // the dashboard would lose the key's name once usage stores a fingerprint.
    const { fingerprintApiKey } = await import("@/lib/db/helpers/apiKeyPrivacy.js");
    // createApiKey(name, machineId) — a 16-char machineId mirrors the real
    // `sk-{machineId}-{keyId}-{crc8}` shape produced at runtime.
    const created = await db.createApiKey("RegressionKey", "07ee777358ca6609");
    expect(created?.key).toBeTruthy();

    await db.saveRequestUsage({
      provider: "openai", model: "gpt-4o", connectionId: "conn-b", apiKey: created.key,
      tokens: { prompt_tokens: 3, completion_tokens: 1 },
      endpoint: "/v1/chat/completions", status: "ok",
    });

    const stats = await db.getUsageStats("24h");
    const named = Object.values(stats.byApiKey || {}).find((b) => b.keyName === "RegressionKey");
    expect(named, "usage stats should attribute the fingerprint to the key name").toBeTruthy();
    expect(named.apiKeyMasked).toBe(fingerprintApiKey(created.key));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// P3 — the observability toggle must be the key that is actually written
// ───────────────────────────────────────────────────────────────────────────
describe("P3: observability toggle is wired to the stored setting", () => {
  it("enableObservability=false suppresses request-detail writes", async () => {
    await db.updateSettings({ enableObservability: false, observabilityBatchSize: 1 });
    // getObservabilityConfig caches for 5s; wait it out rather than reaching in.
    await new Promise((r) => setTimeout(r, 5200));

    const before = adapter.get(`SELECT COUNT(*) c FROM requestDetails`).c;
    await db.saveRequestDetail({
      id: "obs-off-1", provider: "openai", model: "gpt-4", status: "success",
      tokens: {}, request: {}, response: {},
    });
    await new Promise((r) => setTimeout(r, 300));
    const after = adapter.get(`SELECT COUNT(*) c FROM requestDetails`).c;
    expect(after).toBe(before);
  }, 15000);

  it("enableObservability=true re-enables them", async () => {
    await db.updateSettings({ enableObservability: true, observabilityBatchSize: 1 });
    await new Promise((r) => setTimeout(r, 5200));

    await db.saveRequestDetail({
      id: "obs-on-1", provider: "openai", model: "gpt-4", status: "success",
      tokens: {}, request: {}, response: {},
    });
    await new Promise((r) => setTimeout(r, 400));
    const row = adapter.get(`SELECT id FROM requestDetails WHERE id = 'obs-on-1'`);
    expect(row?.id).toBe("obs-on-1");
  }, 15000);

  it("status filter accepts both success vocabularies", async () => {
    // usageHistory writes "ok", requestDetails writes "success"; a filter for
    // either must not come back empty just because of the writer.
    const viaSuccess = await db.getRequestDetails({ status: "success", pageSize: 100 });
    const viaOk = await db.getRequestDetails({ status: "ok", pageSize: 100 });
    expect(viaSuccess.pagination.totalItems).toBe(viaOk.pagination.totalItems);
    expect(viaSuccess.pagination.totalItems).toBeGreaterThan(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// P4 — per-model backoff state must not grow without bound
// ───────────────────────────────────────────────────────────────────────────
describe("P4: modelLock_* pruning and errorCode hygiene", () => {
  it("expired and cleared model locks are dropped on write; active ones survive", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const conn = await db.createProviderConnection({
      provider: "openrouter", authType: "apikey", name: "lock-test", apiKey: "sk-test",
    });

    await db.updateProviderConnection(conn.id, {
      "modelLock_active-model": future,
      "modelLock_expired-model": past,
      "modelLock_cleared-model": null,
      "modelLock_garbage-model": "not-a-date",
    });

    const row = adapter.get(`SELECT data FROM providerConnections WHERE id = ?`, [conn.id]);
    const data = JSON.parse(row.data);
    const lockKeys = Object.keys(data).filter((k) => k.startsWith("modelLock_"));

    expect(lockKeys).toContain("modelLock_active-model");
    expect(lockKeys).not.toContain("modelLock_expired-model");
    expect(lockKeys).not.toContain("modelLock_cleared-model");
    expect(lockKeys).not.toContain("modelLock_garbage-model");
    expect(data["modelLock_active-model"]).toBe(future);
  });

  it("cleanupProviderConnections sweeps a null errorCode", async () => {
    const conn = await db.createProviderConnection({
      provider: "openrouter", authType: "apikey", name: "errcode-test", apiKey: "sk-test-2",
    });
    await db.updateProviderConnection(conn.id, { errorCode: 429 });
    expect(JSON.parse(adapter.get(`SELECT data FROM providerConnections WHERE id = ?`, [conn.id]).data).errorCode).toBe(429);

    await db.updateProviderConnection(conn.id, { errorCode: null });
    await db.cleanupProviderConnections();

    const data = JSON.parse(adapter.get(`SELECT data FROM providerConnections WHERE id = ?`, [conn.id]).data);
    expect("errorCode" in data).toBe(false);
  });

  it("migration 003 clears errorCode only on healthy accounts", async () => {
    // clearAccountError() returns early when there is nothing to clear, so a
    // healthy row with a leftover errorCode is unreachable at runtime — the
    // migration is the only thing that can fix it. A row that is genuinely
    // unavailable must KEEP its errorCode: that is real diagnostics.
    const m003 = (await import("@/lib/db/migrations/003-repair-orphaned-provider-references.js")).default;

    const healthy = await db.createProviderConnection({
      provider: "openrouter", authType: "apikey", name: "stale-code", apiKey: "sk-h",
    });
    await db.updateProviderConnection(healthy.id, { errorCode: 400, testStatus: "active", lastError: null });

    const broken = await db.createProviderConnection({
      provider: "openrouter", authType: "apikey", name: "really-broken", apiKey: "sk-b",
    });
    await db.updateProviderConnection(broken.id, { errorCode: 429, testStatus: "unavailable", lastError: "[429] rate limited" });

    m003.up(adapter);

    const h = JSON.parse(adapter.get(`SELECT data FROM providerConnections WHERE id = ?`, [healthy.id]).data);
    const b = JSON.parse(adapter.get(`SELECT data FROM providerConnections WHERE id = ?`, [broken.id]).data);
    expect(h.errorCode, "healthy account should lose its stale errorCode").toBeUndefined();
    expect(b.errorCode, "unavailable account keeps its diagnostic errorCode").toBe(429);
  });

  it("migration 003 redacts the flat bucket.apiKey written by addToCounter", async () => {
    // addToCounter() spreads `meta` FLAT via Object.assign, so the second copy
    // of the key lands at bucket.apiKey — not bucket.meta.apiKey. A migration
    // that only fixed the nested path left a plaintext key behind.
    const m003 = (await import("@/lib/db/migrations/003-repair-orphaned-provider-references.js")).default;
    const { isFingerprinted } = await import("@/lib/db/helpers/apiKeyPrivacy.js");

    const dateKey = "2020-01-01";
    const bucketKey = `${KEY_B}|gpt-4|openai`;
    adapter.run(
      `INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data`,
      [dateKey, JSON.stringify({
        requests: 1, promptTokens: 1, completionTokens: 1, cachedTokens: 0, cost: 0,
        byApiKey: { [bucketKey]: { requests: 1, cost: 0, apiKey: KEY_B, rawModel: "gpt-4" } },
      })]
    );

    m003.up(adapter);

    const day = JSON.parse(adapter.get(`SELECT data FROM usageDaily WHERE dateKey = ?`, [dateKey]).data);
    const entries = Object.entries(day.byApiKey);
    expect(entries.length).toBe(1);
    const [outKey, bucket] = entries[0];
    expect(outKey).not.toContain(KEY_B);
    expect(isFingerprinted(String(outKey).split("|")[0])).toBe(true);
    expect(bucket.apiKey).not.toBe(KEY_B);
    expect(isFingerprinted(bucket.apiKey)).toBe(true);
    // Counters must be preserved by the rebuild.
    expect(bucket.requests).toBe(1);
  });
  it("deleteProviderNode cascades live configuration but preserves history", async () => {
    const nodeId = "openai-compatible-chat-cascade-node";
    const otherNodeId = "openai-compatible-chat-other-node";
    const node = await db.createProviderNode({
      id: nodeId, type: "openai-compatible", name: "Cascade", prefix: "cascade",
      apiType: "chat", baseUrl: "https://cascade.example/v1",
    });
    await db.createProviderNode({
      id: otherNodeId, type: "openai-compatible", name: "Other", prefix: "other",
      apiType: "chat", baseUrl: "https://other.example/v1",
    });

    const connection = await db.createProviderConnection({
      provider: nodeId, authType: "apikey", name: "cascade-connection", apiKey: "sk-cascade",
    });
    const otherConnection = await db.createProviderConnection({
      provider: otherNodeId, authType: "apikey", name: "other-connection", apiKey: "sk-other",
    });

    await db.addCustomModel({ providerAlias: nodeId, id: "cascade-model", type: "llm" });
    await db.addCustomModel({ providerAlias: otherNodeId, id: "other-model", type: "llm" });
    await db.setModelAlias("cascade-alias", `${nodeId}/cascade-model`);
    await db.setModelAlias(`${nodeId}/legacy-model`, "legacy-cascade-alias");
    await db.setModelAlias("other-alias", `${otherNodeId}/other-model`);
    await db.disableModels(nodeId, ["cascade-model"]);
    await db.disableModels(otherNodeId, ["other-model"]);
    await db.updatePricing({ [nodeId]: { "cascade-model": { input: 1 } }, [otherNodeId]: { "other-model": { input: 2 } } });
    await db.updateSettings({
      providerStrategies: { [nodeId]: { fallbackStrategy: "round-robin" }, [otherNodeId]: { fallbackStrategy: "fallback" } },
      providerThinking: { [nodeId]: { mode: "max" }, [otherNodeId]: { mode: "low" } },
      quotaVisibility: { [nodeId]: { hidden: ["cascade-model"] }, [otherNodeId]: { hidden: ["other-model"] } },
      claudeAutoPing: { connections: { [connection.id]: true, [otherConnection.id]: false } },
      codexAutoPing: { connections: { [connection.id]: true, [otherConnection.id]: false } },
    });
    const combo = await db.createCombo({ name: "cascade-combo", models: [`${nodeId}/cascade-model`, `${otherNodeId}/other-model`] });
    const emptyCombo = await db.createCombo({ name: "only-cascade-combo", models: [`${nodeId}/cascade-model`] });

    // Historical rows intentionally remain after deleting their live connection.
    await db.saveRequestUsage({ provider: nodeId, model: "cascade-model", connectionId: connection.id, tokens: { prompt_tokens: 1 }, status: "ok" });
    await db.saveRequestDetail({ id: "cascade-history", provider: nodeId, model: "cascade-model", connectionId: connection.id, status: "success", request: {}, response: {} });
    await new Promise((r) => setTimeout(r, 250));

    const removed = await db.deleteProviderNode(nodeId);
    expect(removed?.id).toBe(nodeId);

    expect(await db.getProviderNodeById(nodeId)).toBeNull();
    expect(await db.getProviderConnectionById(connection.id)).toBeNull();
    expect(await db.getProviderConnectionById(otherConnection.id)).not.toBeNull();

    const aliases = await db.getModelAliases();
    expect(aliases["cascade-alias"]).toBeUndefined();
    expect(aliases[`${nodeId}/legacy-model`]).toBeUndefined();
    expect(aliases["other-alias"]).toBe(`${otherNodeId}/other-model`);
    expect((await db.getCustomModels()).some((m) => m.providerAlias === nodeId)).toBe(false);
    expect((await db.getCustomModels()).some((m) => m.providerAlias === otherNodeId)).toBe(true);
    expect((await db.getDisabledModels())[nodeId]).toBeUndefined();
    expect((await db.getDisabledModels())[otherNodeId]).toEqual(["other-model"]);
    expect((await db.getPricing())[nodeId]).toBeUndefined();
    expect((await db.getPricing())[otherNodeId]).toBeDefined();

    const settings = await db.getSettings();
    for (const field of ["providerStrategies", "providerThinking", "quotaVisibility"]) {
      expect(settings[field][nodeId]).toBeUndefined();
      expect(settings[field][otherNodeId]).toBeDefined();
    }
    for (const field of ["claudeAutoPing", "codexAutoPing"]) {
      expect(settings[field].connections[connection.id]).toBeUndefined();
      expect(settings[field].connections[otherConnection.id]).toBeDefined();
    }

    const combos = await db.getCombos();
    expect(combos.find((c) => c.id === combo.id)?.models).toEqual([`${otherNodeId}/other-model`]);
    expect(combos.some((c) => c.id === emptyCombo.id)).toBe(false);
    expect((await db.getRequestDetails({ connectionId: connection.id, pageSize: 20 })).pagination.totalItems).toBe(1);
    expect((await db.getUsageHistory({ provider: nodeId })).length).toBe(1);
  });

  it("deleteProviderNode is a no-op for an unknown id", async () => {
    expect(await db.deleteProviderNode("openai-compatible-chat-does-not-exist")).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// P2 — the repair migration is registered and idempotent
// ───────────────────────────────────────────────────────────────────────────
describe("P2: repair migration registration", () => {
  it("SCHEMA_VERSION matches the newest migration and 003 is registered", async () => {
    const { SCHEMA_VERSION } = await import("@/lib/db/schema.js");
    const { MIGRATIONS, latestVersion } = await import("@/lib/db/migrations/index.js");

    expect(latestVersion()).toBe(SCHEMA_VERSION);
    const versions = MIGRATIONS.map((m) => m.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions).toContain(3);
    expect(adapter.get(`SELECT value v FROM _meta WHERE key='schemaVersion'`).v).toBe(String(SCHEMA_VERSION));
  });

  it("migration 003 leaves live references alone and is re-runnable", async () => {
    const m003 = (await import("@/lib/db/migrations/003-repair-orphaned-provider-references.js")).default;

    // A node that EXISTS plus an alias pointing at it: must survive.
    const node = await db.createProviderNode({
      id: "openai-compatible-chat-live-node", type: "openai-compatible",
      name: "Live", prefix: "live", apiType: "chat", baseUrl: "https://example.test/v1",
    });
    await db.setModelAlias("keep-me", `${node.id}/some-model`);
    await db.addCustomModel({ providerAlias: node.id, id: "some-model", type: "llm" });

    // A node that does NOT exist: references must go.
    await db.setModelAlias("drop-me", "openai-compatible-chat-ghost-node/ghost-model");
    await db.addCustomModel({ providerAlias: "openai-compatible-chat-ghost-node", id: "ghost-model", type: "llm" });

    // A user-chosen short prefix is NOT a generated node id — keep it, the user
    // can recreate a node with that prefix.
    await db.setModelAlias("short-prefix", "oc/free-model");

    m003.up(adapter);

    const aliases = await db.getModelAliases();
    expect(aliases["keep-me"]).toBe(`${node.id}/some-model`);
    expect(aliases["short-prefix"]).toBe("oc/free-model");
    expect(aliases["drop-me"]).toBeUndefined();

    const customs = await db.getCustomModels();
    expect(customs.some((m) => m.providerAlias === node.id)).toBe(true);
    expect(customs.some((m) => m.providerAlias === "openai-compatible-chat-ghost-node")).toBe(false);

    // Second run must be a no-op.
    const snapshot = JSON.stringify({
      aliases: await db.getModelAliases(),
      customs: (await db.getCustomModels()).length,
      usage: adapter.all(`SELECT id, apiKey FROM usageHistory ORDER BY id`),
    });
    m003.up(adapter);
    const after = JSON.stringify({
      aliases: await db.getModelAliases(),
      customs: (await db.getCustomModels()).length,
      usage: adapter.all(`SELECT id, apiKey FROM usageHistory ORDER BY id`),
    });
    expect(after).toBe(snapshot);
  });
});
