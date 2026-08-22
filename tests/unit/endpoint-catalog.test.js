import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ENDPOINT_GROUPS,
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
    // Since 0.10.0 the gateway serves ONE public surface (/v1); the catalog
    // splits it into OpenAI-compatible and Anthropic rows plus the Office
    // namespace. Guards against silently losing or re-adding a surface.
    expect(advertised).toEqual(["/v1", "/v1/messages", "/office/v1"]);
    expect(advertised).not.toContain("/v1beta");
    expect(advertised).not.toContain("/codex");
    // The /v1/v1 double-prefix compat surface was removed in 0.9.0.
    expect(advertised).not.toContain("/v1/v1");
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

// NOTE: the quick-start snippet builder + SNIPPET_TABS were removed along with
// the QuickStartCard (redundant with Base URLs) — no snippet tests remain.
