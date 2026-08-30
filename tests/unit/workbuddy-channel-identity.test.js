import { describe, it, expect } from "vitest";
import { WorkbuddyExecutor, neutralizeChannelIdentity } from "../../open-sse/executors/workbuddy.js";
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
