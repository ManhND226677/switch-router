import { NextResponse } from "next/server";
import { getRequestDetails } from "@/lib/usageDb";
import { getProviderConnections, getSettings } from "@/lib/localDb";
import { normalizeFallbackStrategy } from "@/core/routing/routingConfig";
import {
  hydrateConnectionLatency,
  getAllConnectionLatencies,
  getConnectionLatencySnapshot,
} from "open-sse/services/connectionLatency.js";

// Latency percentiles (TTFT/total) + failover rate computed from recent
// requestDetails rows. requestDetails keeps only the last N records
// (observabilityMaxRecords, default 200), so this reflects RECENT latency,
// not all-time history — enough to spot a degraded provider/account.

export const dynamic = "force-dynamic";

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  const idx = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
  return sortedValues[Math.max(0, idx)];
}

function summarizeLatencies(records) {
  const ttfts = records.map((r) => r?.latency?.ttft).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  const totals = records.map((r) => r?.latency?.total).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  const failovers = records.filter((r) => (r?.latency?.attempts || 1) > 1).length;
  const selectionTotal = records.reduce((sum, r) => sum + (r?.latency?.selectionMs || 0), 0);
  return {
    sampleSize: records.length,
    ttft: {
      p50: percentile(ttfts, 50),
      p95: percentile(ttfts, 95),
    },
    total: {
      p50: percentile(totals, 50),
      p95: percentile(totals, 95),
    },
    failoverRate: records.length > 0 ? Number((failovers / records.length).toFixed(4)) : 0,
    avgSelectionMs: records.length > 0 ? Math.round(selectionTotal / records.length) : 0,
  };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider") || undefined;
    const model = searchParams.get("model") || undefined;

    const { details } = await getRequestDetails({
      provider,
      model,
      status: "success",
      pageSize: 200,
    });

    const successRecords = details.filter((d) => Number.isFinite(d?.latency?.total));
    const byProvider = {};
    for (const record of successRecords) {
      const key = record.provider || "unknown";
      (byProvider[key] ||= []).push(record);
    }

    const providers = {};
    for (const [key, records] of Object.entries(byProvider)) {
      providers[key] = summarizeLatencies(records);
    }

    return NextResponse.json({
      ...summarizeLatencies(successRecords),
      providers,
      routing: await describeRoutingLatency(),
    });
  } catch (error) {
    console.error("[API] Failed to compute latency stats:", error);
    return NextResponse.json({ error: "Failed to fetch latency stats" }, { status: 500 });
  }
}

/**
 * What the "fastest" strategy currently believes about each account — the
 * persisted EWMA, which outlives the short requestDetails window the percentiles
 * above are computed from.
 */
async function describeRoutingLatency() {
  try {
    await hydrateConnectionLatency();
    const settings = await getSettings();
    const strategy = normalizeFallbackStrategy(settings.fallbackStrategy);
    const connections = await getProviderConnections({ isActive: true });
    const byId = new Map(connections.map((c) => [c.id, c]));

    const accounts = getAllConnectionLatencies()
      .filter((entry) => byId.has(entry.connectionId))
      .map((entry) => {
        const fresh = getConnectionLatencySnapshot(entry.connectionId);
        const conn = byId.get(entry.connectionId);
        return {
          connectionId: entry.connectionId,
          provider: conn?.provider || null,
          name: conn?.displayName || conn?.name || conn?.email || entry.connectionId.slice(0, 8),
          ewmaTtftMs: entry.ewmaTtftMs,
          ewmaTotalMs: entry.ewmaTotalMs,
          scoreMs: fresh?.scoreMs ?? null,
          samples: entry.samples,
          lastSampleAt: entry.lastSampleAt,
          fresh: fresh != null,
        };
      })
      .sort((a, b) => (a.scoreMs ?? Infinity) - (b.scoreMs ?? Infinity));

    return { strategy, accounts };
  } catch (error) {
    // Observability only — never fail the endpoint over the latency store.
    console.warn(`[API] routing latency snapshot failed: ${error?.message || error}`);
    return { strategy: null, accounts: [] };
  }
}
