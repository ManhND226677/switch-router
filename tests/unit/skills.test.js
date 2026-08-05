import { afterAll, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SKILLS,
  SWITCH_ROUTER_BASE_URL,
  getSkillAbsoluteUrl,
  getSkillDefinition,
} from "../../src/shared/constants/skills.js";
import { GET as getSkill } from "../../src/app/api/skills/[id]/route.js";

// The route resolves the skills dir from process.cwd() (repo root at runtime);
// point it at the repo root no matter where vitest runs from.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
vi.spyOn(process, "cwd").mockReturnValue(repoRoot);
afterAll(() => vi.restoreAllMocks());

describe("Switch-Router skills", () => {
  it("exposes the canonical local skill catalog", () => {
    expect(SKILLS.map((skill) => skill.id)).toEqual([
      "switch-router",
      "switch-router-chat",
      "switch-router-image",
      "switch-router-video",
      "switch-router-tts",
      "switch-router-stt",
      "switch-router-embeddings",
      "switch-router-web-search",
      "switch-router-web-fetch",
    ]);
    expect(SWITCH_ROUTER_BASE_URL).toBe("http://127.0.0.1:28701");
  });

  it("resolves old 9router skill ids without changing the canonical source", () => {
    const canonical = getSkillDefinition("switch-router-chat");
    const legacy = getSkillDefinition("9router-chat");

    expect(legacy).toBe(canonical);
    expect(getSkillAbsoluteUrl("9router-chat")).toBe(
      "http://127.0.0.1:28701/api/skills/9router-chat",
    );
  });

  it("serves canonical and legacy Markdown over the local API", async () => {
    const request = new Request("http://127.0.0.1:28701/api/skills/9router-video");
    const response = await getSkill(request, {
      params: Promise.resolve({ id: "9router-video" }),
    });
    const content = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(content).toContain("# Switch-Router Video");
    expect(content).toContain("28701");
  });

  it("rejects unknown skill ids", async () => {
    const response = await getSkill(
      new Request("http://127.0.0.1:28701/api/skills/unknown"),
      { params: Promise.resolve({ id: "unknown" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { type: "not_found" },
    });
  });
});
