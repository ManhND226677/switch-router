import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const sidebarSource = readFileSync(resolve(here, "../../src/shared/components/Sidebar.js"), "utf8");
const chatSource = readFileSync(
  resolve(here, "../../src/app/(dashboard)/dashboard/basic-chat/BasicChatPageClient.js"),
  "utf8"
);
const globalsSource = readFileSync(resolve(here, "../../src/app/globals.css"), "utf8");

describe("Basic Chat surface contract", () => {
  it("keeps Basic Chat discoverable in the primary navigation", () => {
    expect(sidebarSource).toContain('{ href: "/dashboard/basic-chat", label: "Basic Chat", icon: "chat" }');
    expect(sidebarSource).not.toContain('// { href: "/dashboard/basic-chat", label: "Basic Chat", icon: "chat" }');
  });

  it("uses the versioned gateway chat endpoint", () => {
    expect(chatSource).toContain('fetch("/api/v1/chat/completions"');
    expect(chatSource).not.toContain('fetch("/api/dashboard/chat/completions"');
    expect(chatSource).toContain('fetch("/api/keys"');
    expect(chatSource).toContain('Authorization: `Bearer ${localApiKey}`');
    expect(chatSource).toContain('openrouter/openai/gpt-oss-20b:free');
    expect(chatSource).toContain('resolveChatRequestModel');
  });

  it("keeps passthrough models routed through their connected provider", () => {
    expect(chatSource).toContain("const isPassthrough = Boolean(AI_PROVIDERS[connection.provider]?.passthroughModels)");
    expect(chatSource).toContain("requestModel = `${providerAlias}/${rawId}`");
  });

  it("keeps the core chat controls accessible", () => {
    expect(chatSource).toContain('aria-label="Search models"');
    expect(chatSource).toContain('aria-label="Message AI"');
    expect(chatSource).toContain('aria-label="Send message"');
    expect(chatSource).toContain('aria-live="polite"');
  });

  it("uses shared theme tokens instead of a light-only chat surface", () => {
    expect(chatSource).toContain('data-testid="basic-chat-surface"');
    expect(chatSource).toContain("bg-bg text-text-main");
    expect(chatSource).toContain("bg-surface-2");
    expect(chatSource).toContain("border-border");
    expect(chatSource).toContain("focus-visible:ring-brand-500");
    expect(chatSource).not.toContain("basic-chat-light");
    expect(chatSource).not.toContain("bg-[#212121]");
    expect(chatSource).not.toContain("bg-[#262626]");
    expect(chatSource).not.toContain("bg-[#2f2f2f]");
    expect(chatSource).not.toContain("bg-[#303030]");
    expect(chatSource).not.toContain("border-white");
    expect(chatSource).not.toContain("text-white/");
    expect(chatSource).not.toContain("ring-white");
  });

  it("does not globally force Basic Chat into the light palette", () => {
    expect(globalsSource).not.toContain("basic-chat-light");
    expect(globalsSource).not.toContain('[class~="bg-[#2f2f2f]"]');
    expect(globalsSource).not.toContain('[class~="text-white"]');
  });

  it("explains local gateway authentication failures separately from provider failures", () => {
    expect(chatSource).toContain("Switch-Router requires a local API key.");
    expect(chatSource).toContain("Open Endpoint & Key to create or activate one.");
  });
});
