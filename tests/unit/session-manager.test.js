// A2: locks resolveSessionId priority/stickiness (codex/antigravity centralization).
import { describe, it, expect, beforeEach } from "vitest";
import { resolveContinuationId, resolveSessionId, resolveSessionIdentity, deriveSessionId, clearSessionStore } from "../../open-sse/utils/sessionManager.js";

// Assistant text must reach ASSISTANT_MIN_LEN (80) to use assistant anchor; else first user message.
const longAssistant = "x".repeat(80);
const bodyWithAssistant = { messages: [{ role: "assistant", content: longAssistant }] };
const bodyWithUserOnly = { messages: [{ role: "user", content: "hello from first user message anchor" }] };

beforeEach(() => {
  clearSessionStore();
});

describe("resolveSessionId", () => {
  it("stickiness: same body+connectionId+scope -> same id", () => {
    const opts = { body: bodyWithAssistant, connectionId: "conn1", scope: "codex" };
    expect(resolveSessionId(opts)).toBe(resolveSessionId(opts));
  });

  it("different connectionId -> different id", () => {
    const a = resolveSessionId({ body: bodyWithAssistant, connectionId: "connA", scope: "codex" });
    const b = resolveSessionId({ body: bodyWithAssistant, connectionId: "connB", scope: "codex" });
    expect(a).not.toBe(b);
  });

  it("different scope -> different id", () => {
    const a = resolveSessionId({ body: bodyWithAssistant, connectionId: "conn1", scope: "codex" });
    const b = resolveSessionId({ body: bodyWithAssistant, connectionId: "conn1", scope: "antigravity" });
    expect(a).not.toBe(b);
  });

  it("first user message anchor when assistant text below cap", () => {
    const opts = { body: bodyWithUserOnly, connectionId: "conn1", scope: "codex" };
    expect(resolveSessionId(opts)).toBe(resolveSessionId(opts));
  });

  it("assistant anchor wins once assistant text reaches cap", () => {
    const shortAssistant = { messages: [{ role: "user", content: "same user" }, { role: "assistant", content: "y".repeat(80) }] };
    const a = resolveSessionId({ body: shortAssistant, connectionId: "conn1", scope: "codex" });
    const b = resolveSessionId({ body: shortAssistant, connectionId: "conn1", scope: "codex" });
    expect(a).toBe(b);
  });

  it("fallback: empty body+no header+no workspaceId -> deriveSessionId(connectionId)", () => {
    const got = resolveSessionId({ body: {}, connectionId: "connFallback" });
    expect(got).toBe(deriveSessionId("connFallback"));
  });

  it("client override: x-session-id header wins, skips later steps", () => {
    const got = resolveSessionId({
      headers: { "x-session-id": "client-sess-123" },
      body: bodyWithAssistant,
      connectionId: "conn1",
      workspaceId: "ws1",
      scope: "codex",
    });
    expect(got).toBe("client-sess-123");
  });

  it("keeps raw metadata.user_id as a session fallback", () => {
    const got = resolveSessionId({
      body: {
        metadata: { user_id: "user-123" },
        messages: [{ role: "user", content: "non-special provider" }],
      },
      connectionId: "conn1",
      scope: "codex",
    });

    expect(got).toBe("user-123");
  });

  it("keeps x-client-request-id as a session override", () => {
    const got = resolveSessionId({
      headers: { "x-client-request-id": "req-1" },
      body: bodyWithAssistant,
      connectionId: "conn1",
      scope: "codex",
    });

    expect(got).toBe("req-1");
  });


  it("workspaceId path: empty body + workspaceId set -> normalized workspaceId", () => {
    const got = resolveSessionId({ body: {}, connectionId: "conn1", workspaceId: "ws-abc" });
    expect(got).toBe("ws-abc");
  });


});

describe("resolveContinuationId", () => {
  it("keeps continuation id stable for the same session", () => {
    const opts = { sessionId: "test-session-1", connectionId: "conn1", scope: "codex" };
    expect(resolveContinuationId(opts)).toBe(resolveContinuationId(opts));
  });

  it("uses a different continuation id for a different session", () => {
    const a = resolveContinuationId({ sessionId: "test-session-1", connectionId: "conn1", scope: "codex" });
    const b = resolveContinuationId({ sessionId: "test-session-2", connectionId: "conn1", scope: "codex" });
    expect(a).not.toBe(b);
  });

  it("does not evict a recently used continuation id when the store exceeds its cap", () => {
    const first = resolveContinuationId({ sessionId: "test-session-0", connectionId: "conn1", scope: "codex" });
    for (let i = 1; i < 5000; i++) {
      resolveContinuationId({ sessionId: `test-session-${i}`, connectionId: "conn1", scope: "codex" });
    }
    expect(resolveContinuationId({ sessionId: "test-session-0", connectionId: "conn1", scope: "codex" })).toBe(first);
    resolveContinuationId({ sessionId: "test-session-5000", connectionId: "conn1", scope: "codex" });

    expect(resolveContinuationId({ sessionId: "test-session-0", connectionId: "conn1", scope: "codex" })).toBe(first);
  });

  it("evicts old continuation ids when the store exceeds its cap", () => {
    const first = resolveContinuationId({ sessionId: "test-session-0", connectionId: "conn1", scope: "codex" });
    for (let i = 1; i <= 5000; i++) {
      resolveContinuationId({ sessionId: `test-session-${i}`, connectionId: "conn1", scope: "codex" });
    }

    const afterEviction = resolveContinuationId({ sessionId: "test-session-0", connectionId: "conn1", scope: "codex" });
    expect(afterEviction).not.toBe(first);
  });

  it("does not let ephemeral continuations evict explicit session continuations", () => {
    const stable = resolveContinuationId({ sessionId: "explicit-session", connectionId: "conn1", scope: "codex" });
    for (let i = 0; i <= 5000; i++) {
      resolveContinuationId({ sessionId: `ephemeral-session-${i}`, connectionId: "conn1", scope: "codex", ephemeral: true });
    }

    expect(resolveContinuationId({ sessionId: "explicit-session", connectionId: "conn1", scope: "codex" })).toBe(stable);
  });
});
