// Conversation → account affinity. Guards the three properties the feature
// depends on: the key must be stable across turns of one conversation, it must
// differ between conversations/models, and a pin must stop influencing routing
// once the conversation goes quiet.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  sessionPinKey,
  pinSession,
  getPinnedConnection,
  getSessionPinStats,
} from "../../open-sse/services/sessionPinning.js";

const turn = (role, content) => ({ role, content });
const CONVERSATION = [turn("system", "You are a terse assistant."), turn("user", "first question")];

describe("sessionPinKey", () => {
  it("is stable while the conversation prefix is unchanged", () => {
    const first = sessionPinKey("claude-sonnet-5", CONVERSATION);
    const later = sessionPinKey("claude-sonnet-5", [
      ...CONVERSATION,
      turn("assistant", "answer"),
      turn("user", "follow-up"),
    ]);
    expect(first).toBeTruthy();
    expect(later).toBe(first);
  });

  it("differs per conversation and per model", () => {
    expect(sessionPinKey("m", CONVERSATION)).not.toBe(
      sessionPinKey("m", [turn("system", "You are a terse assistant."), turn("user", "OTHER question")])
    );
    expect(sessionPinKey("m-a", CONVERSATION)).not.toBe(sessionPinKey("m-b", CONVERSATION));
  });

  it("returns null until there is a conversation to keep warm", () => {
    expect(sessionPinKey("m", undefined)).toBeNull();
    expect(sessionPinKey("m", [])).toBeNull();
    expect(sessionPinKey("m", [turn("user", "hi")])).toBeNull();
  });

  it("survives the Responses API shape (input array with non-string content)", () => {
    const key = sessionPinKey("gpt-5", [
      turn("system", [{ type: "input_text", text: "be nice" }]),
      turn("user", [{ type: "input_text", text: "hello" }]),
    ]);
    expect(key).toBeTruthy();
    expect(sessionPinKey("gpt-5", [
      turn("system", [{ type: "input_text", text: "be nice" }]),
      turn("user", [{ type: "input_text", text: "hello" }]),
    ])).toBe(key);
  });

  it("never throws on content it cannot serialise", () => {
    const cyclic = { role: "user" };
    cyclic.content = cyclic;
    expect(() => sessionPinKey("m", [turn("user", "x"), cyclic])).not.toThrow();
  });
});

// Store-level behaviour. Keys are generated per case rather than relying on a
// global reset: the module store is a process singleton and the routing suite
// below registers its own pins.
describe("pin store", () => {
  it("remembers and returns the account for a pinned conversation", () => {
    const key = sessionPinKey("m", [turn("system", "store-a"), turn("user", "first question")]);
    expect(getPinnedConnection(key)).toBeNull();
    pinSession(key, "conn-1");
    expect(getPinnedConnection(key)).toBe("conn-1");
  });

  it("expires a conversation that went quiet and forgets it", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-28T00:00:00Z"));
      const key = sessionPinKey("m", [turn("system", "store-b"), turn("user", "first question")]);
      const before = getSessionPinStats().active;
      pinSession(key, "conn-2");
      expect(getPinnedConnection(key)).toBe("conn-2");

      vi.advanceTimersByTime(16 * 60 * 1000);
      expect(getPinnedConnection(key)).toBeNull();
      expect(getSessionPinStats().active).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores the noauth pseudo connection and reports per-account load", () => {
    const ignored = sessionPinKey("m", [turn("system", "store-c"), turn("user", "first")]);
    pinSession(ignored, "noauth");
    expect(getPinnedConnection(ignored)).toBeNull();

    const shared = sessionPinKey("m", [turn("system", "store-d"), turn("user", "first")]);
    const other = sessionPinKey("m", [turn("system", "store-e"), turn("user", "first")]);
    pinSession(shared, "conn-3");
    pinSession(other, "conn-3");
    expect(getSessionPinStats().byConnection["conn-3"]).toBe(2);
  });
});

// ─── routing integration: does the pin actually change selection? ───────────
const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let auth;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "switch-router-affinity-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("../../src/lib/db/index.js");
  await db.initDb();
  auth = await import("../../src/sse/services/auth.js");
});

afterAll(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("conversation affinity in credential selection", () => {
  const PROVIDER = "affinityprov";
  const MODEL = "affinity-model";
  let first, second, conversationKey;

  beforeAll(async () => {
    [first, second] = await Promise.all([
      db.createProviderConnection({ provider: PROVIDER, authType: "apikey", name: "A-first", apiKey: "k1" }),
      db.createProviderConnection({ provider: PROVIDER, authType: "apikey", name: "B-second", apiKey: "k2" }),
    ]);
    await db.updateSettings({ fallbackStrategy: "fill-first" });
    conversationKey = sessionPinKey(MODEL, [turn("system", "affinity"), turn("user", "hello")]);
    pinSession(conversationKey, second.id);
  });

  it("serves a running conversation from the account that holds its cache", async () => {
    const pinned = await auth.getProviderCredentials(PROVIDER, null, MODEL, { sessionKey: conversationKey });
    expect(pinned.connectionId).toBe(second.id);
  });

  it("leaves requests without a conversation key to the normal strategy", async () => {
    const plain = await auth.getProviderCredentials(PROVIDER, null, MODEL);
    expect(plain.connectionId).toBe(first.id);
  });

  it("falls through when the pinned account is excluded or model-locked", async () => {
    const excluded = await auth.getProviderCredentials(PROVIDER, new Set([second.id]), MODEL, { sessionKey: conversationKey });
    expect(excluded.connectionId).toBe(first.id);

    const { MODEL_LOCK_PREFIX } = await import("../../open-sse/services/accountFallback.js");
    await db.updateProviderConnection(second.id, {
      [`${MODEL_LOCK_PREFIX}${MODEL}`]: new Date(Date.now() + 60_000).toISOString(),
    });
    const locked = await auth.getProviderCredentials(PROVIDER, null, MODEL, { sessionKey: conversationKey });
    expect(locked.connectionId).toBe(first.id);

    await db.updateProviderConnection(second.id, { [`${MODEL_LOCK_PREFIX}${MODEL}`]: null });
  });
});
