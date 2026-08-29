import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Repo root from this file's own location (tests/unit → ../..) so the suite
// passes from any cwd, not just `npm test` (which runs with cwd = tests/).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Lightweight source contract: slow providers must not stay on 15s abort.
describe("model ping timeout policy", () => {
  const src = readFileSync(path.join(root, "src/app/api/models/test/ping.js"), "utf8");

  it("uses a longer timeout for antigravity/gemini probes", () => {
    expect(src).toMatch(/pingTimeoutMs/);
    expect(src).toMatch(/ag\//);
    expect(src).toMatch(/90000/);
    expect(src).not.toMatch(/AbortSignal\.timeout\(15000\)/);
  });
});
