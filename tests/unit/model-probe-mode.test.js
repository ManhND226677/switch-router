import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Repo root from this file's own location (tests/unit → ../..) so the suite
// passes from any cwd, not just `npm test` (which runs with cwd = tests/).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("dashboard model probe mode", () => {
  const ping = readFileSync(path.join(root, "src/app/api/models/test/ping.js"), "utf8");
  const chat = readFileSync(path.join(root, "src/sse/handlers/chat.js"), "utf8");
  const base = readFileSync(path.join(root, "open-sse/executors/base.js"), "utf8");

  it("sends x-9r-probe header from ping", () => {
    expect(ping).toMatch(/x-9r-probe/);
  });

  it("chat path respects probe: single attempt + no lock", () => {
    expect(chat).toMatch(/x-9r-probe/);
    expect(chat).toMatch(/maxAttempts:\s*isProbe\s*\?\s*1/);
    expect(chat).toMatch(/test-only failure/);
    expect(chat).toMatch(/isProbe:\s*true/);
  });

  it("executor disables retry config for probe bodies/credentials", () => {
    expect(base).toMatch(/isProbe/);
    expect(base).toMatch(/__probe/);
  });
});
