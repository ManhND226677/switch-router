import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// Separate DATA_DIR so this suite never touches the developer's real DB.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "switch-router-export-test-"));
process.env.DATA_DIR = path.join(tmpDir, "data");
process.env.NODE_ENV = "test";

const db = await import("../../src/lib/db/index.js");
const { SECRET_SENTINEL } = db;

async function seedConnection(provider, extra = {}) {
  // createProviderConnection mints its own id — return the created row.
  return await db.createProviderConnection({
    provider, authType: "oauth", name: `${provider}-conn`, email: `${provider}@example.com`,
    ...extra,
  });
}

async function seedApiKey(id, key) {
  // createApiKey mints its own key from the machine id — insert the fixed
  // test key directly through the same repo path used by importDb.
  const dbAdapter = await (await import("../../src/lib/db/driver.js")).getAdapter();
  dbAdapter.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, allowedModels) VALUES(?, ?, ?, ?, 1, ?, '[]')`,
    [id, key, `key-${id}`, "test-machine", new Date().toISOString()]
  );
}

describe.sequential("exportDb / importDb secret masking", () => {
  beforeAll(async () => {
    await db.initDb();
  });

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* temp cleanup */ }
  });

  it("export masks connection tokens, email and api key rows", async () => {
    const created = await seedConnection("antigravity", {
      accessToken: "ya29.secret-token", refreshToken: "1//refresh-secret", apiKey: "sk-live-key",
    });
    await seedApiKey("key-1", "sk-abcdef0123456789machine");
    const connId = created.id;

    const exported = await db.exportDb();

    const conn = exported.providerConnections.find((c) => c.id === connId);
    expect(conn.accessToken).toBe(SECRET_SENTINEL);
    expect(conn.refreshToken).toBe(SECRET_SENTINEL);
    expect(conn.apiKey).toBe(SECRET_SENTINEL);
    expect(conn.email).toBe(SECRET_SENTINEL);
    expect(JSON.stringify(exported)).not.toContain("ya29.secret-token");
    expect(JSON.stringify(exported)).not.toContain("1//refresh-secret");

    const key = exported.apiKeys.find((k) => k.id === "key-1");
    expect(key.key.startsWith("sk-abcde")).toBe(true);
    expect(key.key).not.toBe("sk-abcdef0123456789machine");
    expect(JSON.stringify(exported)).not.toContain("sk-abcdef0123456789machine");
  });

  it("backup round-trip keeps working credentials (live values win over masked snapshot)", async () => {
    const snap = await db.exportDb();
    const connId = snap.providerConnections[0]?.id;
    expect(connId).toBeDefined();

    // The masked snapshot carries sentinels only.
    const snapConn = snap.providerConnections.find((c) => c.id === connId);
    expect(snapConn.accessToken).toBe(SECRET_SENTINEL);

    // Import the snapshot back: sentinels are replaced by whatever the live DB
    // currently holds for that connection id — the backup file never had to
    // contain the real secret for the restore to work.
    await db.importDb(snap);

    const conns = await db.getProviderConnections();
    const conn = conns.find((c) => c.id === connId);
    expect(conn.accessToken).toBe("ya29.secret-token");
    expect(conn.refreshToken).toBe("1//refresh-secret");
    expect(conn.email).toBe("antigravity@example.com");

    const keys = await db.getApiKeys();
    const key = keys.find((k) => k.id === "key-1");
    expect(key.key).toBe("sk-abcdef0123456789machine");
    expect(await db.validateApiKey("sk-abcdef0123456789machine")).toBe(true);
  });

  it("a foreign backup with sentinels drops unmatched secrets instead of storing placeholders", async () => {
    const foreign = await db.exportDb();
    // Simulate another machine's backup: replace the id so nothing matches locally.
    foreign.providerConnections = foreign.providerConnections.map((c) => ({
      ...c, id: "foreign-conn", accessToken: SECRET_SENTINEL, refreshToken: SECRET_SENTINEL, email: SECRET_SENTINEL,
    }));
    foreign.apiKeys = foreign.apiKeys.map((k) => ({ ...k, id: "foreign-key" }));

    await db.importDb(foreign);

    const conns = await db.getProviderConnections();
    const conn = conns.find((c) => c.id === "foreign-conn");
    expect(conn).toBeDefined();
    expect(conn.accessToken).toBeUndefined();
    expect(conn.refreshToken).toBeUndefined();
    expect(conn.email).toBeNull();

    const keys = await db.getApiKeys();
    expect(keys.find((k) => k.id === "foreign-key")).toBeUndefined();
  });

  it("proxy pool credentials are masked in export and restored on import", async () => {
    const pool = await db.createProxyPool({ name: "p1", proxyUrl: "http://user:pass@127.0.0.1:7890" });
    const poolId = pool.id;

    const exported = await db.exportDb();
    const exportedPool = exported.proxyPools.find((p) => p.id === poolId);
    expect(exportedPool.proxyUrl).not.toContain("user:pass");
    expect(JSON.stringify(exported)).not.toContain("user:pass");

    await db.importDb(exported);

    const pools = await db.getProxyPools();
    const restored = pools.find((p) => p.id === poolId).proxyUrl.replace(/\/$/, "");
    expect(restored).toBe("http://user:pass@127.0.0.1:7890");
  });
});
