"use client";

// Latency (TTFT p50/p95 + failover rate, from /api/usage/latency over recent
// requestDetails) and cache-hit telemetry (/api/usage/cache). Recent-window
// data only — requestDetails keeps the last N records, so this reflects "how
// is routing behaving right now", not all-time history.
import { useEffect, useState } from "react";
import Card from "@/shared/components/Card";

const fmtMs = (n) => (n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`);
const fmtTok = (n) => new Intl.NumberFormat().format(n || 0);
const fmtUsd = (n) => {
  const v = Number(n) || 0;
  if (v >= 100) return `$${v.toFixed(0)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(3)}`;
};

function LatencyCard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let isMounted = true;
    fetch("/api/usage/latency")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (isMounted) setData(d); })
      .catch(() => {});
    const t = setInterval(() => {
      fetch("/api/usage/latency")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (isMounted && d) setData(d); })
        .catch(() => {});
    }, 60000);
    return () => { isMounted = false; clearInterval(t); };
  }, []);

  const providers = Object.entries(data?.providers || {}).sort((a, b) => (a[1].ttft.p50 ?? Infinity) - (b[1].ttft.p50 ?? Infinity));
  const routing = data?.routing;

  return (
    <Card className="flex min-w-0 flex-col p-4 h-full" padding="none">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-text-main">Latency (recent)</h3>
        <span className="material-symbols-outlined text-text-muted/70 text-lg">av_timer</span>
      </div>
      {!data || data.sampleSize === 0 ? (
        <p className="text-sm text-text-muted">No recent requests with latency data yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
            <div>
              <div className="text-lg font-bold text-text-main">{fmtMs(data.ttft.p50)}</div>
              <div className="text-xs text-text-muted">TTFT p50</div>
            </div>
            <div>
              <div className="text-lg font-bold text-text-main">{fmtMs(data.ttft.p95)}</div>
              <div className="text-xs text-text-muted">TTFT p95</div>
            </div>
            <div>
              <div className="text-lg font-bold text-text-main">{Math.round((data.failoverRate || 0) * 100)}%</div>
              <div className="text-xs text-text-muted">Failovers</div>
            </div>
          </div>
          <div className="flex flex-col divide-y divide-border/50">
            {providers.slice(0, 6).map(([name, s]) => (
              <div key={name} className="flex items-center justify-between py-1.5 text-sm">
                <span className="text-text-main truncate pr-2">{name}</span>
                <span className="text-text-muted whitespace-nowrap font-mono text-xs">
                  {fmtMs(s.ttft.p50)} / {fmtMs(s.ttft.p95)}
                  {s.sampleSize > 0 && <span className="text-text-muted/60"> ({s.sampleSize})</span>}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {routing?.accounts?.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border-subtle">
          <div className="flex items-center justify-between mb-1.5">
            <h4 className="text-xs uppercase tracking-wide text-text-muted">Routing EWMA</h4>
            <span className={`text-xs font-mono ${routing.strategy === "fastest" ? "text-primary" : "text-text-muted/70"}`}>
              {routing.strategy === "fastest" ? "fastest" : `${routing.strategy || "unknown"} (unused)`}
            </span>
          </div>
          <div className="flex flex-col divide-y divide-border/50">
            {routing.accounts.slice(0, 6).map((a) => (
              <div key={a.connectionId} className="flex items-center justify-between py-1.5 text-sm">
                <span className="text-text-main truncate pr-2">
                  {a.name}
                  <span className="text-text-muted/70 text-xs"> · {a.provider}</span>
                </span>
                <span className="whitespace-nowrap font-mono text-xs text-text-muted">
                  {fmtMs(a.scoreMs ?? a.ewmaTtftMs)}
                  {!a.fresh && <span className="text-text-muted/60"> stale</span>}
                  <span className="text-text-muted/60"> ({a.samples})</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function CacheCard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let isMounted = true;
    fetch("/api/usage/cache?period=7d")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (isMounted) setData(d); })
      .catch(() => {});
  }, []);

  const providers = Object.entries(data?.providers || {}).sort((a, b) => (b[1].promptTokens || 0) - (a[1].promptTokens || 0));
  const hitRate = Math.round((data?.totals?.hitRate || 0) * 100);

  return (
    <Card className="flex min-w-0 flex-col p-4 h-full" padding="none">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-text-main">Cache hit (7d)</h3>
        <span className="material-symbols-outlined text-text-muted/70 text-lg">cached</span>
      </div>
      {!data || data.totals.requests === 0 ? (
        <p className="text-sm text-text-muted">No cached-token data in the last 7 days.</p>
      ) : (
        <>
          <div className="flex items-baseline gap-2 mb-3 flex-wrap">
            <div className="text-2xl font-bold text-primary">{hitRate}%</div>
            <div className="text-xs text-text-muted">
              {fmtTok(data.totals.cachedTokens)} / {fmtTok(data.totals.promptTokens)} input tokens read from cache
            </div>
            {data.totals.savedUsd > 0 && (
              <div className="text-xs font-semibold text-green-600 dark:text-green-400">
                ≈ {fmtUsd(data.totals.savedUsd)} saved
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {providers.slice(0, 6).map(([name, s]) => {
              const pct = Math.round((s.hitRate || 0) * 100);
              return (
                <div key={name} className="text-sm">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-text-main truncate pr-2">{name}</span>
                    <span className="text-text-muted font-mono text-xs">
                      {pct}%
                      {s.savedUsd > 0 && <span className="text-green-600 dark:text-green-400"> · {fmtUsd(s.savedUsd)}</span>}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-bg-alt overflow-hidden">
                    <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}

export default function LatencyCachePanel() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <LatencyCard />
      <CacheCard />
    </div>
  );
}
