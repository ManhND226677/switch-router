import { getProviderConnectionById, getProviderConnections } from "@/lib/localDb";
import { resolveStepFunApiMode } from "open-sse/providers/stepfun.js";

function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request) {
  const expected = process.env.SWITCH_ROUTER_INTERNAL_SECRET;
  if (!expected || request.headers.get("x-switch-router-internal-secret") !== expected) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body?.provider && body.provider !== "stepfun") {
    return Response.json({ error: "Unsupported provider" }, { status: 400 });
  }

  const connection = body.connectionId
    ? await getProviderConnectionById(body.connectionId)
    : (await getProviderConnections({ provider: "stepfun", isActive: true }))[0];
  if (!connection || connection.provider !== "stepfun" || connection.isActive === false) {
    return Response.json({ error: "StepFun connection not found" }, { status: 404 });
  }

  const token = connection.apiKey || connection.accessToken;
  if (!token) return Response.json({ error: "StepFun connection has no token" }, { status: 401 });
  return Response.json({
    connectionId: connection.id,
    provider: connection.provider,
    token,
    apiMode: resolveStepFunApiMode(connection),
  });
}
