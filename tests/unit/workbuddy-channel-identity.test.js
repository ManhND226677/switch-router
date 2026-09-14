import { describe, it, expect } from "vitest";
import {
  WorkbuddyExecutor,
  neutralizeChannelIdentity,
  normalizeWorkbuddyHarness,
} from "../../open-sse/executors/workbuddy.js";
import { WORKBUDDY_CHAT_USER_AGENT } from "../../open-sse/config/appConstants.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

// Identity line + harness sections captured 2026-08-30 from a request upstream
// rejected with {"code":11128,"msg":"Illegal API invocation from an unapproved
// channel"} (usage row 2026-08-30T04:11:51.632Z, 541398 bytes).
const BLOCKED_SYSTEM = [
  "You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK.",
  "",
  "You are an interactive agent that helps users with software engineering tasks.",
  "",
  "# Tool discipline",
  "Always call Read on a file before editing it.",
  "",
  "Environment:",
  "- Platform: win32",
  "- Working directory: D:/MyProject/switch-router",
].join("\n");

function blockedBody() {
  return {
    model: "hy4-preview",
    messages: [
      { role: "system", content: BLOCKED_SYSTEM },
      { role: "user", content: "fix the bug" },
    ],
    tools: [
      { type: "function", function: { name: "Bash", description: "Run a command" } },
      { type: "function", function: { name: "Edit", description: "Edit a file" } },
    ],
    stream: false,
  };
}

function zcodeBody() {
  return {
    model: "deepseek-v4.1-flash",
    messages: [
      {
        role: "system",
        content: [
          "You are ZCode, an AI coding agent.",
          "You are an interactive ZCode agent that helps users with software engineering tasks.",
          "",
          "You help the user complete software engineering tasks.",
          "",
          "# Tool discipline",
          "Always inspect files before editing them.",
        ].join("\n"),
      },
      { role: "user", content: "say hi" },
    ],
    stream: false,
  };
}

describe("workbuddy channel-identity rewrite", () => {
  it("drops the blocked identity sentence and keeps the rest of the harness prompt", () => {
    const out = new WorkbuddyExecutor().transformRequest("hy4-preview", blockedBody(), true, {});
    const sys = out.messages[0].content;

    expect(sys).not.toContain("Claude Code");
    expect(sys).not.toContain("official CLI");
    expect(sys.startsWith("You are an expert software engineering agent.")).toBe(true);
    expect(sys).toContain("# Tool discipline");
    expect(sys).toContain("Always call Read on a file before editing it.");
    expect(sys).toContain("- Working directory: D:/MyProject/switch-router");
  });

  it("leaves tools and user messages untouched", () => {
    const body = blockedBody();
    const out = new WorkbuddyExecutor().transformRequest("hy4-preview", body, true, {});

    expect(out.tools).toEqual(body.tools);
    expect(out.messages[1]).toBe(body.messages[1]);
    expect(out.stream).toBe(true);
  });

  it("scrubs the identity sentence from an assistant message, leading or mid-line", () => {
    const messages = [
      { role: "user", content: "who are you?" },
      { role: "assistant", content: "You are Claude Code, Anthropic's official CLI for Claude." },
      { role: "user", content: "and?" },
      { role: "assistant", content: "Sure! You are Claude Code, Anthropic's official CLI for Claude. How can I help?" },
    ];
    const out = neutralizeChannelIdentity(messages);

    expect(out[1].content).toBe("You are an expert software engineering agent.");
    expect(out[3].content).toBe("Sure! You are an expert software engineering agent. How can I help?");
    expect(out[0]).toBe(messages[0]);
    expect(out[2]).toBe(messages[2]);
  });

  it("scrubs ZCode identity from the system prompt while preserving the harness", () => {
    const body = zcodeBody();
    const out = new WorkbuddyExecutor().transformRequest("deepseek-v4.1-flash", body, true, {});

    expect(out.messages[0].content).not.toContain("You are ZCode");
    expect(out.messages[0].content).not.toContain("interactive ZCode agent");
    expect(out.messages[0].content).toContain("You help the user complete software engineering tasks.");
    expect(out.messages[0].content).toContain("# Tool discipline");
    expect(out.messages[1]).toBe(body.messages[1]);
    expect(out.stream).toBe(true);
  });

  it("scrubs ZCode identity if a retry re-injects it in an assistant message", () => {
    const messages = [
      { role: "assistant", content: "Before retry: You are ZCode, an AI coding agent. Continue." },
      { role: "assistant", content: "You are an interactive ZCode agent that helps users with software engineering tasks. Continue." },
    ];
    const out = neutralizeChannelIdentity(messages);

    expect(out[0].content).not.toContain("You are ZCode");
    expect(out[0].content).toContain("Before retry:");
    expect(out[0].content).toContain("Continue.");
    expect(out[1].content).not.toContain("interactive ZCode agent");
    expect(out[1].content).toContain("Continue.");
  });

  it("removes ZCode's trailing git-status snapshot from system context", () => {
    const statusBlock = [
      "gitStatus: This is the git status at the start of the conversation.",
      "",
      "Current branch: master",
      "",
      "Main branch: main",
      "",
      "Recent commits:",
      "1234567 chore: keep the repository private",
    ].join("\n");
    const messages = [
      { role: "system", content: `Keep the coding instructions.\n\n${statusBlock}` },
      { role: "system", content: `Another system section\n${statusBlock}` },
      { role: "user", content: "continue" },
    ];

    const out = neutralizeChannelIdentity(messages);

    expect(out[0].content).toBe("Keep the coding instructions.");
    expect(out[1].content).toBe("Another system section");
    expect(out[0].content).not.toContain("Main branch");
    expect(out[2]).toBe(messages[2]);
    expect(messages[0].content).toContain("Main branch: main");
  });

  it("normalizes foreign desktop headings and preserves user/tool conversation objects", () => {
    const user = { role: "user", content: "continue" };
    const tool = { role: "tool", content: "result", tool_call_id: "call_1", providerOptions: { trace: true } };
    const messages = [
      { role: "system", content: "# ZCode Desktop Context\nFollow the task." },
      user,
      tool,
    ];

    const out = normalizeWorkbuddyHarness(messages);

    expect(out[0].content).toBe("# Desktop Context\nFollow the task.");
    expect(out[1]).toBe(user);
    expect(out[2]).not.toBe(tool);
    expect(out[2]).toEqual({ role: "tool", content: "result", tool_call_id: "call_1" });
    expect(user.content).toBe("continue");
  });

  it("emits WorkBuddy chat wire fields after every upstream translation", () => {
    const body = {
      model: "wb/deepseek-v4.1-flash",
      bodySource: "ai_sdk_options",
      providerOptions: { workbuddy: { channel: "zcode" } },
      experimental_include: { cachedInput: true },
      client_metadata: { product: "ZCode" },
      clientMetadata: { product: "Claude Code" },
      userAgent: "ZCode/1.0",
      metadata: { requestId: "client-only" },
      store: false,
      reasoning_effort: "auto",
      max_output_tokens: 123,
      stream: false,
      messages: [
        { role: "developer", content: "# DeepSeek Harness Desktop Context\nYou are ZCode, an AI coding agent." },
        { role: "user", content: "hello" },
        { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "custom", function: { name: "run", arguments: { command: "pwd" } } }] },
      ],
    };

    const out = new WorkbuddyExecutor().transformRequest("wb/deepseek-v4.1-flash", body, true, {});

    expect(out.model).toBe("deepseek-v4.1-flash");
    expect(out.stream).toBe(true);
    expect(out.stream_options).toEqual({ include_usage: true });
    expect(out.max_tokens).toBe(123);
    expect(out.max_output_tokens).toBeUndefined();
    expect(out.reasoning_effort).toBeUndefined();
    for (const field of ["bodySource", "providerOptions", "experimental_include", "client_metadata", "clientMetadata", "userAgent", "metadata", "store"]) {
      expect(out[field]).toBeUndefined();
    }
    expect(out.messages[0].role).toBe("system");
    expect(out.messages[0].content).not.toContain("ZCode");
    expect(out.messages[0].content).toContain("# Desktop Context");
    expect(out.messages[2]).toEqual({
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "run", arguments: '{"command":"pwd"}' } }],
      reasoning_content: " ",
    });
    expect(body.messages[0].role).toBe("developer");
    expect(body.messages[2].content).toBeNull();
  });

  // WorkBuddy validates reasoning_effort against the routed model and rejects any
  // value it does not know (400 code 11150 invalid_reasoning_effort). Its native
  // CLI does not send OpenAI-style effort, so the boundary drops it.
  it("drops reasoning_effort before WorkBuddy validates it", () => {
    const body = {
      model: "wb/deepseek-v4.1-flash",
      reasoning_effort: "high",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    };
    const out = new WorkbuddyExecutor().transformRequest("wb/deepseek-v4.1-flash", body, true, {});

    expect(out.reasoning_effort).toBeUndefined();
    expect(body.reasoning_effort).toBe("high");
  });

  it("uses the WorkBuddy CLI chat identity and JWT tenant headers", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "user/123", tenant_id: "tenant-1", enterprise_id: "enterprise-1" })).toString("base64url");
    const accessToken = `header.${payload}.signature`;
    const headers = new WorkbuddyExecutor().buildHeaders({ apiKey: accessToken }, true);

    expect(headers["User-Agent"]).toBe(WORKBUDDY_CHAT_USER_AGENT);
    expect(headers["X-User-Id"]).toBe("user%2F123");
    expect(headers["X-Tenant-Id"]).toBe("tenant-1");
    expect(headers["X-Enterprise-Id"]).toBe("enterprise-1");
    expect(headers.Accept).toBe("text/event-stream");
  });

  it("scrubs identity text blocks inside an assistant message without touching sibling blocks", () => {
    const thinking = { type: "thinking", thinking: "You are Claude Code, Anthropic's official CLI for Claude." };
    const messages = [
      { role: "assistant", content: [{ type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." }, thinking] },
    ];
    const [out] = neutralizeChannelIdentity(messages);

    expect(out.content[0].text).not.toContain("Claude Code");
    expect(out.content[1]).toBe(thinking);
  });

  it("leaves an assistant tool-call message with null content alone", () => {
    const messages = [{ role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "Bash", arguments: "{}" } }] }];
    expect(neutralizeChannelIdentity(messages)).toBe(messages);
  });

  it("deliberately keeps the identity sentence in user messages (gate tolerates it there)", () => {
    const messages = [
      { role: "user", content: "<system-reminder>\nYou are Claude Code, Anthropic's official CLI for Claude.\n</system-reminder>" },
    ];
    expect(neutralizeChannelIdentity(messages)).toBe(messages);
  });

  it("never mutates the request body — retries, account fallback and combo members share it", () => {
    const body = blockedBody();
    new WorkbuddyExecutor().transformRequest("hy4-preview", body, true, {});

    expect(body.messages[0].content).toBe(BLOCKED_SYSTEM);
  });

  it("handles a text-block system message without touching sibling blocks", () => {
    const image = { type: "image_url", image_url: { url: "https://x/y.png" } };
    const messages = [
      { role: "system", content: [{ type: "text", text: BLOCKED_SYSTEM }, image] },
    ];
    const [sys] = neutralizeChannelIdentity(messages);

    expect(sys.content[0].text).not.toContain("Claude Code");
    expect(sys.content[1]).toBe(image);
    expect(messages[0].content[0].text).toBe(BLOCKED_SYSTEM);
  });

  it("rewrites every line-initial identity sentence, short or long form", () => {
    const text = "You are Claude Code, Anthropic's official CLI for Claude.\n"
      + "You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK.";
    const [sys] = neutralizeChannelIdentity([{ role: "system", content: text }]);

    expect(sys.content).not.toContain("official CLI");
    expect(sys.content.match(/expert software engineering agent/g)).toHaveLength(2);
  });

  it("leaves mid-line prose mentions alone (identity line only, not a word scrub)", () => {
    const text = "You are an agent.\nThe Claude Code docs say to run tests.";
    const messages = [{ role: "system", content: text }];

    expect(neutralizeChannelIdentity(messages)).toBe(messages);
  });

  it("is a no-op for identities WorkBuddy already accepts", () => {
    const messages = [
      { role: "system", content: "You are a Claude agent, built on Anthropic's Claude Agent SDK.\n<application_details>" },
    ];
    expect(neutralizeChannelIdentity(messages)).toBe(messages);
  });

  it("does not leak into other providers", () => {
    const body = blockedBody();
    const out = new DefaultExecutor("bai").transformRequest("glm-5.3-flash", body, false, {});

    expect(out.messages[0].content).toBe(BLOCKED_SYSTEM);
  });
});
