import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Repo root from this file's own location (tests/unit → ../..) so the suite
// passes from any cwd, not just `npm test` (which runs with cwd = tests/).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("antigravity requires real Cloud Code projectId", () => {
  const exec = readFileSync(path.join(root, "open-sse/executors/antigravity.js"), "utf8");
  const oauth = readFileSync(path.join(root, "src/lib/oauth/providers.js"), "utf8");
  const chat = readFileSync(path.join(root, "src/sse/handlers/chat.js"), "utf8");

  it("does not call generateProjectId as generate fallback", () => {
    // transformRequest must not invent random projects
    expect(exec).toMatch(/MISSING_PROJECT_ID|projectId is missing/);
    expect(exec).not.toMatch(/credentials\?\.projectId \|\| this\.generateProjectId\(\)/);
  });

  it("oauth onboard runs when projectId is missing", () => {
    expect(oauth).toMatch(/if \(!projectId\)/);
    expect(oauth).toMatch(/onboardUserEndpoint/);
  });

  it("chat fails closed when antigravity project cannot be resolved", () => {
    expect(chat).toMatch(/Cloud Code projectId missing/);
    expect(chat).toMatch(/provider === "antigravity"/);
  });
});
