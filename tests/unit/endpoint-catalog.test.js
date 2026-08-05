import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ENDPOINT_GROUPS,
  SNIPPET_TABS,
  buildSnippet,
} from "../../src/app/(dashboard)/dashboard/endpoint/endpointConstants.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const NEXT_CONFIG = readFileSync(path.join(REPO_ROOT, "next.config.mjs"), "utf8");

/** Every `source:` string declared in next.config.mjs rewrites(). */
function declaredRewriteSources() {
  return [...NEXT_CONFIG.matchAll(/source:\s*"([^"]+)"/g)].map((match) => match[1]);
}

const ORIGIN = "http://127.0.0.1:28701";

describe("endpoint catalog", () => {
  it("gives every group a unique id and a rooted path", () => {
    const ids = ENDPOINT_GROUPS.map((group) => group.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const group of ENDPOINT_GROUPS) {
      expect(group.path.startsWith("/")).toBe(true);
      expect(group.label.length).toBeGreaterThan(0);
      expect(group.badge.length).toBeGreaterThan(0);
      expect(["accent", "office", "muted"]).toContain(group.tone);
    }
  });

  it("advertises only paths the app actually serves", () => {
    // A rewrite source of "/v1/:path*" serves "/v1" and everything under it.
    const prefixes = declaredRewriteSources().map((source) => source.replace(/\/:path\*$/, ""));
    // The Office namespace is a real route dir, not a rewrite.
    const servedPrefixes = [...prefixes, "/office/v1"];

    for (const group of ENDPOINT_GROUPS) {
      const served = servedPrefixes.some(
        (prefix) => group.path === prefix || group.path.startsWith(`${prefix}/`),
      );
      expect(served, `${group.id} -> ${group.path} is not served by any rewrite or route`).toBe(true);
    }
  });

  it("keeps a catalog entry for each client-facing rewrite family", () => {
    const advertised = ENDPOINT_GROUPS.map((group) => group.path);
    // Guards against the catalog silently losing a surface during a refactor.
    expect(advertised).toContain("/v1");
    expect(advertised).toContain("/v1/messages");
    expect(advertised).toContain("/v1beta");
    expect(advertised).toContain("/codex");
    expect(advertised).toContain("/v1/v1");
    expect(advertised).toContain("/office/v1");
  });

  it("hides the Office group behind its feature flag", () => {
    const office = ENDPOINT_GROUPS.find((group) => group.id === "office");
    expect(office.requiresOfficeGateway).toBe(true);

    const withoutFlag = ENDPOINT_GROUPS.filter(
      (group) => !group.requiresOfficeGateway || false,
    );
    expect(withoutFlag.some((group) => group.id === "office")).toBe(false);
  });
});

describe("quick-start snippets", () => {
  it("uses the placeholder when no key is chosen", () => {
    for (const tab of SNIPPET_TABS) {
      const snippet = buildSnippet(tab.value, ORIGIN);
      expect(snippet).toContain("<YOUR_API_KEY>");
      expect(snippet).not.toContain("sk-");
    }
  });

  it("inlines a real key only when one is passed", () => {
    const snippet = buildSnippet("curl", ORIGIN, "sk-test-123");
    expect(snippet).toContain("sk-test-123");
    expect(snippet).not.toContain("<YOUR_API_KEY>");
  });

  it("points OpenAI clients at /v1 and Anthropic clients at the origin", () => {
    expect(buildSnippet("openai", ORIGIN)).toContain(`base_url="${ORIGIN}/v1"`);
    // The Anthropic SDK appends /v1/messages itself, so its base must be the origin.
    expect(buildSnippet("anthropic", ORIGIN)).toContain(`base_url="${ORIGIN}"`);
  });

  it("emits both env var families", () => {
    const env = buildSnippet("env", ORIGIN);
    expect(env).toContain(`OPENAI_BASE_URL=${ORIGIN}/v1`);
    expect(env).toContain(`ANTHROPIC_BASE_URL=${ORIGIN}`);
  });
});
