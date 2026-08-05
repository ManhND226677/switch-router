import { getUsageStats, statsEmitter, getActiveRequests } from "@/lib/usageDb";

export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

if (!global._usageStreamHub) {
  global._usageStreamHub = {
    clients: new Set(),
    stats: null,
    statsJson: null,
    refreshPromise: null,
    quickPromise: null,
    listenersAttached: false,
    onUpdate: null,
    onPending: null,
  };
}

const hub = global._usageStreamHub;

function closeClient(client) {
  if (!client || client.closed) return;
  client.closed = true;
  client.pending = null;
  hub.clients.delete(client);

  if (hub.clients.size === 0 && hub.listenersAttached) {
    statsEmitter.off("update", hub.onUpdate);
    statsEmitter.off("pending", hub.onPending);
    hub.listenersAttached = false;
  }
}

function sendSerialized(client, serialized) {
  if (!client || client.closed || !serialized) return;

  // ReadableStream.enqueue is synchronous, but retain only the latest value
  // if a future runtime applies a queued/backpressured controller.
  if (client.sending) {
    client.pending = serialized;
    return;
  }

  client.sending = true;
  try {
    client.controller.enqueue(encoder.encode(`data: ${serialized}\n\n`));
  } catch {
    closeClient(client);
  } finally {
    client.sending = false;
  }

  if (!client.closed && client.pending) {
    const next = client.pending;
    client.pending = null;
    sendSerialized(client, next);
  }
}

function broadcastSerialized(serialized) {
  for (const client of [...hub.clients]) sendSerialized(client, serialized);
}

async function broadcastQuickSnapshot() {
  if (!hub.stats || hub.clients.size === 0) return;
  const { activeRequests, recentRequests, errorProvider } = await getActiveRequests();
  const quick = {
    ...hub.stats,
    activeRequests,
    recentRequests,
    errorProvider,
  };
  broadcastSerialized(JSON.stringify(quick));
}

async function loadInitialSnapshot() {
  if (hub.stats) return hub.stats;
  if (hub.refreshPromise) return hub.refreshPromise;

  hub.refreshPromise = getUsageStats("all")
    .then((stats) => {
      hub.stats = stats;
      hub.statsJson = JSON.stringify(stats);
      return stats;
    })
    .finally(() => {
      hub.refreshPromise = null;
    });

  return hub.refreshPromise;
}

function scheduleFullRefresh() {
  if (hub.refreshPromise || hub.clients.size === 0) return hub.refreshPromise;

  hub.refreshPromise = (async () => {
    if (hub.stats) await broadcastQuickSnapshot();
    const stats = await getUsageStats("all");
    hub.stats = stats;
    hub.statsJson = JSON.stringify(stats);
    broadcastSerialized(hub.statsJson);
    return stats;
  })().finally(() => {
    hub.refreshPromise = null;
  });

  return hub.refreshPromise;
}

function scheduleQuickRefresh() {
  if (hub.quickPromise || hub.clients.size === 0) return;
  hub.quickPromise = broadcastQuickSnapshot()
    .catch(() => {})
    .finally(() => {
      hub.quickPromise = null;
    });
}

function ensureListeners() {
  if (hub.listenersAttached) return;

  hub.onUpdate = () => {
    void scheduleFullRefresh()?.catch?.(() => {});
  };
  hub.onPending = () => scheduleQuickRefresh();
  statsEmitter.on("update", hub.onUpdate);
  statsEmitter.on("pending", hub.onPending);
  hub.listenersAttached = true;
}

export async function GET(request) {
  const state = {
    closed: false,
    client: null,
    keepalive: null,
  };

  const cleanup = () => {
    if (state.closed) return;
    state.closed = true;
    if (state.keepalive) clearInterval(state.keepalive);
    closeClient(state.client);
  };

  request.signal.addEventListener("abort", cleanup, { once: true });

  const stream = new ReadableStream({
    async start(controller) {
      const client = {
        controller,
        closed: false,
        sending: false,
        pending: null,
      };
      state.client = client;
      hub.clients.add(client);
      ensureListeners();

      try {
        await loadInitialSnapshot();
        if (!state.closed && !client.closed && hub.statsJson) {
          sendSerialized(client, hub.statsJson);
        }
        if (state.closed || client.closed) return;

        state.keepalive = setInterval(() => {
          if (state.closed || client.closed) {
            clearInterval(state.keepalive);
            return;
          }
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            cleanup();
          }
        }, 25000);
        state.keepalive?.unref?.();
      } catch {
        cleanup();
      }
    },

    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
