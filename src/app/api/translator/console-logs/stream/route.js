import { getConsoleSnapshot, getConsoleEmitter, initConsoleLogCapture } from "@/lib/consoleLogBuffer";

export const dynamic = "force-dynamic";

initConsoleLogCapture();

export async function GET(request) {
  const encoder = new TextEncoder();
  const emitter = getConsoleEmitter();
  const state = { closed: false, sendLines: null, sendClear: null, keepalive: null };
  let initializing = true;
  const queuedEvents = [];

  // Idempotent: safe to call from request.signal abort, cancel(), or enqueue failure.
  const cleanup = () => {
    if (state.closed) return;
    state.closed = true;
    if (state.sendLines) emitter.off("lines", state.sendLines);
    if (state.sendClear) emitter.off("clear", state.sendClear);
    if (state.keepalive) clearInterval(state.keepalive);
  };

  // request.signal fires reliably on client disconnect; ReadableStream.cancel()
  // is not always invoked in Next.js, which caused listeners to accumulate.
  request.signal.addEventListener("abort", cleanup, { once: true });

  const stream = new ReadableStream({
    start(controller) {
      // Subscribe before taking the snapshot. Events raised during this
      // synchronous hand-off are buffered until the init frame is sent, so a
      // client cannot miss a line between snapshot and listener registration.
      state.sendLines = (lines) => {
        if (state.closed || !Array.isArray(lines) || lines.length === 0) return;
        if (initializing) {
          queuedEvents.push({ type: "lines", lines });
          return;
        }
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "lines", lines })}\n\n`));
        } catch {
          cleanup();
        }
      };

      // Notify client when cleared
      state.sendClear = () => {
        if (state.closed) return;
        if (initializing) {
          queuedEvents.push({ type: "clear" });
          return;
        }
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "clear" })}\n\n`));
        } catch {
          cleanup();
        }
      };

      emitter.on("lines", state.sendLines);
      emitter.on("clear", state.sendClear);

      const buffered = getConsoleSnapshot();
      if (buffered.logs.length > 0) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "init", logs: buffered.logs })}\n\n`));
      }

      initializing = false;
      for (const event of queuedEvents.splice(0, queuedEvents.length)) {
        if (state.closed) break;
        if (event.type === "clear") state.sendClear();
        else state.sendLines(event.lines);
      }

      // Keepalive ping every 25s
      state.keepalive = setInterval(() => {
        if (state.closed) { clearInterval(state.keepalive); return; }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, 25000);
    },

    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
