import { registerSession, unregisterSession, findPlugin } from "@/lib/mcp/stdioSseBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { plugin } = await params;
  if (!findPlugin(plugin)) {
    return new Response(`Unknown plugin: ${plugin}`, { status: 404 });
  }

  const encoder = new TextEncoder();
  let sid;
  let cleanedUp = false;
  const cleanupOnce = () => {
    if (cleanedUp || !sid) return;
    cleanedUp = true;
    unregisterSession(plugin, sid);
  };

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk) => controller.enqueue(encoder.encode(chunk));
      sid = registerSession(plugin, send);
      // MCP SSE handshake: tell client where to POST messages.
      send(`event: endpoint\ndata: /api/mcp/${plugin}/message?sessionId=${sid}\n\n`);
    },
    cancel() {
      // Clean client disconnect (ReadableStream cancelled).
      cleanupOnce();
    },
  });

  // Hard client drop (no clean cancel): request aborts, the stream never runs
  // cancel(), and the session would otherwise leak in the bridge together with
  // the npx child process it keeps alive.
  request.signal?.addEventListener("abort", cleanupOnce, { once: true });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
