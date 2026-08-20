import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Lightweight source contract: slow providers must not stay on 15s abort.
describe("model ping timeout policy", () => {
  const src = readFileSync(
    path.resolve(process.cwd(), "../src/app/api/models/test/ping.js"),
    "utf8",
  );

  it("uses a longer timeout for antigravity/gemini probes", () => {
    expect(src).toMatch(/pingTimeoutMs/);
    expect(src).toMatch(/ag\//);
    expect(src).toMatch(/90000/);
    expect(src).not.toMatch(/AbortSignal\.timeout\(15000\)/);
  });
});
