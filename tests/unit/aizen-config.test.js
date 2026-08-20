import { describe, it, expect } from "vitest";
import {
  maskApiKey,
  diskConfigToDashboard,
  mergeDashboardIntoDisk,
  endpointMatchFromUrl,
  SWITCH_ROUTER_PROVIDER_NAME,
} from "../../src/lib/aizenConfig.js";

describe("aizenConfig helpers", () => {
  it("masks api keys", () => {
    expect(maskApiKey("sk-abcdefghijklmnop")).toMatch(/^sk-\*\*\*/);
    expect(maskApiKey("")).toBe("");
  });

  it("endpointMatchFromUrl detects loopback", () => {
    expect(endpointMatchFromUrl("http://127.0.0.1:28701/v1")).toBe("configured");
    expect(endpointMatchFromUrl("https://api.vilao.ai/v1")).toBe("other");
    expect(endpointMatchFromUrl("")).toBe("not_configured");
  });

  it("diskConfigToDashboard never leaks raw key", () => {
    const dash = diskConfigToDashboard({
      base_url: "https://api.vilao.ai/v1",
      api_key: "sk-secret-key-value-here",
      model: "grok-4.5",
      reasoning_effort: "high",
      compact_threshold_pct: 60,
      providers: [{ name: "Vilao", base_url: "https://api.vilao.ai/v1", api_key: "sk-secret", model: "grok-4.5" }],
      active_provider: "Vilao",
    }, { mcpServers: { "codebase-memory": { command: "x" } } });

    expect(dash.apiKey).toBe("");
    expect(dash.hasApiKey).toBe(true);
    expect(dash.apiKeyMasked).toContain("***");
    expect(dash.activeModel).toBe("grok-4.5");
    expect(dash.thinkingEffort).toBe("high");
    expect(dash.autoCompact).toBe(true);
    expect(dash.mcpCodebaseMemory).toBe(true);
    expect(dash.providers[0].apiKeyMasked).toContain("***");
  });

  it("mergeDashboardIntoDisk upserts Switch-Router profile for local endpoint", () => {
    const existing = {
      base_url: "https://api.vilao.ai/v1",
      api_key: "sk-old",
      model: "grok-4.5",
      providers: [
        { name: "Vilao", base_url: "https://api.vilao.ai/v1", api_key: "sk-old", model: "grok-4.5" },
      ],
      active_provider: "Vilao",
      approval_mode: "yolo",
    };

    const merged = mergeDashboardIntoDisk(existing, {
      baseUrl: "http://127.0.0.1:28701/v1",
      apiKey: "sk_gateway_key",
      activeModel: "vilao/grok-4.5",
      thinkingEffort: "medium",
      autoCompact: true,
      subagentModel: "cheap/model",
    });

    expect(merged.base_url).toBe("http://127.0.0.1:28701/v1");
    expect(merged.api_key).toBe("sk_gateway_key");
    expect(merged.model).toBe("vilao/grok-4.5");
    expect(merged.active_provider).toBe(SWITCH_ROUTER_PROVIDER_NAME);
    expect(merged.providers.some((p) => p.name === SWITCH_ROUTER_PROVIDER_NAME)).toBe(true);
    expect(merged.providers.some((p) => p.name === "Vilao")).toBe(true); // preserved
    expect(merged.reasoning_effort).toBe("medium");
    expect(merged.compact_threshold_pct).toBe(60);
    expect(merged.subagent_model).toBe("cheap/model");
    expect(merged.approval_mode).toBe("yolo"); // unrelated field kept
  });
});
