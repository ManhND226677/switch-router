import { describe, expect, it } from "vitest";
import {
  getProviderRoutingPolicy,
  normalizeProviderRoutingOverride,
  normalizeRoutingSettingsPatch,
} from "../../src/core/routing/routingConfig.js";

describe("provider account routing configuration", () => {
  it("resolves provider overrides over global defaults", () => {
    const policy = getProviderRoutingPolicy({
      fallbackStrategy: "round-robin",
      stickyRoundRobinLimit: "4.9",
      providerStrategies: {
        openai: {
          fallbackStrategy: "fill-first",
          stickyRoundRobinLimit: 2,
          rotateStrategy: "random",
          proxyPoolId: " pool-a ",
        },
      },
    }, "openai");

    expect(policy).toEqual({
      fallbackStrategy: "fill-first",
      stickyRoundRobinLimit: 2,
      rotateStrategy: "random",
      proxyPoolId: "pool-a",
    });
  });

  it("falls back safely when persisted settings are invalid", () => {
    expect(getProviderRoutingPolicy({
      fallbackStrategy: "unsupported",
      stickyRoundRobinLimit: 0,
      providerStrategies: {
        openai: {
          fallbackStrategy: "invalid",
          stickyRoundRobinLimit: "nope",
          rotateStrategy: "invalid",
          proxyPoolId: "__none__",
        },
      },
    }, "openai")).toEqual({
      fallbackStrategy: "fill-first",
      stickyRoundRobinLimit: 3,
      rotateStrategy: "none",
      proxyPoolId: null,
    });
  });

  it("normalizes settings patches without mutating the caller object", () => {
    const input = {
      fallbackStrategy: "round-robin",
      stickyRoundRobinLimit: "5",
      providerStrategies: {
        openai: { fallbackStrategy: null, stickyRoundRobinLimit: "2.8" },
        free: { rotateStrategy: "random", proxyPoolId: " pool-b " },
      },
    };

    const normalized = normalizeRoutingSettingsPatch(input);

    expect(normalized).toEqual({
      fallbackStrategy: "round-robin",
      stickyRoundRobinLimit: 5,
      providerStrategies: {
        openai: { stickyRoundRobinLimit: 2 },
        free: { rotateStrategy: "random", proxyPoolId: "pool-b" },
      },
    });
    expect(input.providerStrategies.openai.fallbackStrategy).toBeNull();
    expect(normalizeProviderRoutingOverride({ fallbackStrategy: "" })).toEqual({});
  });
});
