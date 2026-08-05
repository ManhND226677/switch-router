import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSkillDefinition } from "@/shared/constants/skills";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function GET(_request, { params }) {
  const { id } = await params;
  const skill = getSkillDefinition(id);

  if (!skill) {
    return Response.json(
      { error: { message: `Unknown skill: ${id}`, type: "not_found" } },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  const skillsRoot = path.resolve(process.cwd(), "skills");
  const filePath = path.resolve(process.cwd(), skill.sourceFile);
  const rootPrefix = `${skillsRoot}${path.sep}`;

  if (!filePath.startsWith(rootPrefix)) {
    return Response.json(
      { error: { message: "Invalid skill source", type: "server_error" } },
      { status: 500, headers: CORS_HEADERS },
    );
  }

  try {
    const content = await readFile(filePath, "utf8");
    return new Response(content, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(`[skills] failed to read ${skill.id}:`, error.message);
    return Response.json(
      { error: { message: "Skill content is unavailable", type: "server_error" } },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
