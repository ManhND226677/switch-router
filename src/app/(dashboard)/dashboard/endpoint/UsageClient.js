"use client";

// Usage body of the merged Endpoint & Usage dashboard (tab "usage").
// Extracted verbatim from the former /dashboard/usage page — only the
// outermost tab/period controls moved up into the shared page shell, so this
// component receives `subTab` ("overview" | "logs") and reports changes back.
import { Suspense, useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { CardSkeleton, SegmentedControl, Button } from "@/shared/components";
import Card from "@/shared/components/Card";
import RequestDetailsTab from "../usage/components/RequestDetailsTab";
import ProviderDistribution from "./components/ProviderDistribution";
import TopModelBilling from "./components/TopModelBilling";
import LatencyCachePanel from "./components/LatencyCachePanel";
import { fetchModelNames, getModelName } from "@/shared/utils/modelNames";

// recharts (~100 KB gzip) stays off the critical path — charts render after data arrives anyway
const UsageTrendChart = dynamic(() => import("./components/UsageTrendChart"), {
  ssr: false,
  loading: () => <CardSkeleton />,
});
const ModelPieChart = dynamic(() => import("../usage/components/ModelPieChart"), { ssr: false });

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
];

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(4)}`;

function timeAgo(timestamp) {
  if (!timestamp) return "—";
  const diff = Math.floor((Date.now() - new Date(timestamp)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// One shared 30s ticker drives every TimeAgo row instead of an interval per row.
const timeAgoTickers = new Set();
let timeAgoTimer = null;
function useTimeAgoTicker() {
  const [, setTick] = useState(0);
  useEffect(() => {
    timeAgoTickers.add(setTick);
    if (!timeAgoTimer) {
      timeAgoTimer = setInterval(() => timeAgoTickers.forEach((fn) => fn((t) => t + 1)), 30000);
    }
    return () => {
      timeAgoTickers.delete(setTick);
      if (timeAgoTickers.size === 0 && timeAgoTimer) {
        clearInterval(timeAgoTimer);
        timeAgoTimer = null;
      }
    };
  }, []);
}
function TimeAgo({ timestamp }) {
  useTimeAgoTicker();
  return <>{timeAgo(timestamp)}</>;
}

function MetricCard({ title, value, trend, trendUp, icon, sub }) {
  return (
    <Card className="flex min-w-0 flex-col justify-between p-4 h-full" padding="none" hover>
      <div className="flex items-center justify-between mb-3">
        <span className="text-text-muted text-sm font-medium truncate">{title}</span>
        {icon && <span className="material-symbols-outlined text-text-muted/70 text-lg shrink-0">{icon}</span>}
      </div>
      <div className="text-2xl sm:text-3xl font-bold text-text-main truncate tracking-tight">{value}</div>
      {(sub || trend) && (
        <div className="mt-1.5 flex items-center gap-2 min-w-0">
          {trend && (
            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-md shrink-0 ${trendUp ? "bg-success/10 text-success" : "bg-error/10 text-error"}`}>
              {trend}
            </span>
          )}
          {sub && <span className="text-xs text-text-muted truncate">{sub}</span>}
        </div>
      )}
    </Card>
  );
}

// Map a dashboard period to explicit ISO bounds for /api/usage/export.
function periodRange(period) {
  const now = new Date();
  if (period === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { startDate: start.toISOString(), endDate: now.toISOString() };
  }
  const hours = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30, "90d": 24 * 90 }[period];
  if (!hours) return {};
  return {
    startDate: new Date(now.getTime() - hours * 3600 * 1000).toISOString(),
    endDate: now.toISOString(),
  };
}

function OverviewDashboard({ period, reloadTick = 0 }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modelNames, setModelNames] = useState({});
  const [statsVersion, setStatsVersion] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const fetchDataRef = useRef(null);

const [providerNameMap, setProviderNameMap] = useState({});

  useEffect(() => {
    fetch('/api/usage/providers')
      .then(r => r.ok ? r.json() : { providers: [] })
      .then(data => {
        const map = {};
        for (const p of data.providers || []) map[p.id] = p.name;
        setProviderNameMap(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function fetchData() {
      try {
        const [r, names, chart] = await Promise.all([
          fetch(`/api/usage/stats?period=${period}&_t=${Date.now()}`),
          fetchModelNames(),
          fetch(`/api/usage/chart?period=${period}&_t=${Date.now()}`),
        ]);
        const data = r.ok ? await r.json() : null;
        const chartJson = chart.ok ? await chart.json() : [];
        if (isMounted) {
          if (data) setStats(data);
          setModelNames(names);
          setChartData(Array.isArray(chartJson) ? chartJson : []);
          setLoading(false);
        }
      } catch (error) {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchDataRef.current = fetchData;
    fetchData();

    // SSE statsVersion pushes drive real updates; this slow fallback only
    // keeps time-windowed periods ("today"/"24h") fresh while the tab idles.
    const fallback = setInterval(fetchData, 60000);

    return () => {
      isMounted = false;
      clearInterval(fallback);
    };
  }, [period, reloadTick]);

  // SSE delivers the live slices (recentRequests, activeRequests, errorProvider)
  // plus a statsVersion counter — a new version means the period-scoped stats
  // caches were invalidated and should be refetched (replaces fixed polling).
  useEffect(() => {
    let lastStatsVersion = null;
    const es = new EventSource("/api/usage/stream");
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (Array.isArray(data.alerts)) setAlerts(data.alerts);
        setStats((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            activeRequests: data.activeRequests,
            recentRequests: data.recentRequests,
            errorProvider: data.errorProvider,
          };
        });
        if (data.statsVersion != null && data.statsVersion !== lastStatsVersion) {
          const isInitialSnapshot = lastStatsVersion === null;
          lastStatsVersion = data.statsVersion;
          // The initial snapshot arrives with the mount fetch already in
          // flight — only later version bumps trigger a refetch.
          if (!isInitialSnapshot) {
            setStatsVersion(data.statsVersion);
            fetchDataRef.current?.();
          }
        }
      } catch (err) {}
    };
    es.onerror = (err) => console.warn("[SSE] Connection error, will retry:", err);
    return () => es.close();
  }, []);

  if (loading && !stats) return <CardSkeleton />;
  if (!stats) return <div className="text-text-muted">Failed to load dashboard data.</div>;

  const aggregatedModelData = Object.values(stats.byModel || {}).reduce((acc, data) => {
    const name = getModelName(data.rawModel, modelNames);
    const value = (data.promptTokens || 0) + (data.completionTokens || 0);
    if (value > 0) {
      acc[name] = (acc[name] || 0) + value;
    }
    return acc;
  }, {});

  const modelData = Object.entries(aggregatedModelData)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="flex flex-col gap-6 fade-in">
      {/* Budget / spend-spike alerts (pushed live on the usage stream) */}
      {alerts.length > 0 && (
        <div className="flex flex-col gap-2">
          {alerts.slice(0, 4).map((a, i) => (
            <div
              key={`${a.ts}-${i}`}
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                a.level >= 100
                  ? "border-error/40 bg-error/10 text-error"
                  : a.level >= 80
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    : "border-primary/30 bg-primary/5 text-text-main"
              }`}
            >
              <span className="material-symbols-outlined text-base shrink-0 mt-0.5">
                {a.type === "spend-spike" ? "trending_up" : "savings"}
              </span>
              <span className="min-w-0">{a.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* KPI strip — workbench style: 5 cards with icon + sub-line */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          title="Requests"
          icon="monitoring"
          value={fmt(stats.totalRequests)}
          trend={stats.successRate != null ? `${stats.successRate}% success` : undefined}
          trendUp={(stats.successRate ?? 0) >= 50}
        />
        <MetricCard
          title="Total tokens"
          icon="database"
          value={fmt((stats.totalPromptTokens || 0) + (stats.totalCompletionTokens || 0))}
          sub={`Cache hit ${(stats.totalPromptTokens || 0) > 0 ? Math.round(((stats.totalCachedTokens || 0) / stats.totalPromptTokens) * 100) : 0}%`}
        />
        <MetricCard
          title="Billing"
          icon="payments"
          value={fmtCost(stats.totalCost)}
          sub={stats.totalRequests > 0 ? `$${((stats.totalCost || 0) / stats.totalRequests).toFixed(3)} per request` : "—"}
        />
        <MetricCard
          title="Average TTFT"
          icon="av_timer"
          value={stats.avgLatencyMs > 0 ? (stats.avgLatencyMs >= 1000 ? `${(stats.avgLatencyMs / 1000).toFixed(1)} s` : `${stats.avgLatencyMs} ms`) : "—"}
          sub={stats.totalFailed ? `${fmt(stats.totalFailed)} failed` : "All requests succeeded"}
        />
        <MetricCard
          title="Accounts"
          icon="group"
          value={String(Object.keys(stats.byProvider || {}).length)}
          sub={`${Object.keys(stats.byModel || {}).length} models`}
        />
      </div>

      {/* Charts Row: combined trend (2/3) + provider distribution (1/3) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card className="flex min-w-0 flex-col gap-3 p-3 sm:p-4 h-full min-h-[300px]">
            <UsageTrendChart data={chartData} />
          </Card>
        </div>
        <div className="lg:col-span-1">
          <ProviderDistribution byProvider={stats.byProvider || {}} />
        </div>
      </div>

      {/* Latency (TTFT p50/p95 + failover) & cache-hit telemetry */}
      <LatencyCachePanel />

      {/* Top model billing */}
      <TopModelBilling byModel={stats.byModel || {}} modelNames={modelNames} />

      {/* Recent Requests Table */}
      <Card padding="none" className="overflow-hidden">
        <div className="p-4 border-b border-border bg-bg-subtle/30">
          <h3 className="font-semibold text-text-main">Recent Requests</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-bg-subtle/20 text-text-muted uppercase text-xs">
              <tr>
                <th className="px-6 py-3.5 font-semibold">Status</th>
                <th className="px-6 py-3.5 font-semibold">Model</th>
                <th className="px-6 py-3.5 font-semibold">Provider</th>
                <th className="px-6 py-3.5 font-semibold text-right">Tokens (In/Out)</th>
                <th className="px-6 py-3.5 font-semibold text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {stats.recentRequests?.slice(0, 10).map((r, i) => {
                const isSuccess = !r.status || r.status === "ok" || r.status === "success";
                return (
                  <tr key={i} className="hover:bg-bg-subtle/30 transition-colors">
                    <td className="px-6 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${
                          isSuccess ? "bg-success/10 text-success" : "bg-error/10 text-error"
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            isSuccess ? "bg-success" : "bg-error"
                          }`}
                        ></span>
                        {isSuccess ? "Success" : "Failed"}
                      </span>
                    </td>
                    <td className="px-6 py-3 font-medium text-text-main">{r.model}</td>
                    <td className="px-6 py-3 text-text-muted">{providerNameMap[r.provider] || r.provider || "N/A"}</td>
                    <td className="px-6 py-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2.5 text-xs">
                        <span className="text-text-muted">
                          In <span className={`font-mono font-medium ${r.estimated ? "" : "text-primary"}`}>{r.estimated ? "~" : ""}{fmt(r.promptTokens)}</span>
                        </span>
                        {r.cachedTokens > 0 && (
                          <span className="text-text-muted">
                            <span className="font-mono font-medium text-primary">↻{fmt(r.cachedTokens)}</span>
                          </span>
                        )}
                        <span className="text-text-muted">
                          Out <span className={`font-mono font-medium ${r.estimated ? "" : "text-success"}`}>{r.estimated ? "~" : ""}{fmt(r.completionTokens)}</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">
                      <TimeAgo timestamp={r.timestamp} />
                    </td>
                  </tr>
                );
              })}
              {!stats.recentRequests?.length && (
                <tr>
                  <td colSpan="5" className="px-6 py-8 text-center text-text-muted">
                    No recent requests
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export default function UsageClient({ refreshKey = 0 }) {
  const [period, setPeriod] = useState("24h");
  const [view, setView] = useState("overview"); // "overview" | "logs"
  const [reloadTick, setReloadTick] = useState(0);

  // External refresh (header button) bumps refreshKey → refetch everything.
  const handleRefresh = () => setReloadTick((t) => t + 1);

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Header row: Dashboard title + period pills + Refresh + Logs toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold tracking-tight text-text-main">Dashboard</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={view === "overview" ? "receipt_long" : "insights"}
            onClick={() => setView(view === "overview" ? "logs" : "overview")}
          >
            {view === "overview" ? "Logs" : "Overview"}
          </Button>
          {view === "overview" && (
            <>
              <SegmentedControl
                options={PERIODS}
                value={period}
                onChange={setPeriod}
                size="sm"
              />
              <Button
                variant="secondary"
                size="sm"
                icon="refresh"
                onClick={() => { handleRefresh(); }}
                title="Refresh"
              >
                Refresh
              </Button>
            </>
          )}
        </div>
      </div>

      {view === "overview" && (
        <Suspense fallback={<CardSkeleton />}>
          <OverviewDashboard period={period} reloadTick={reloadTick + refreshKey} />
        </Suspense>
      )}
      {view === "logs" && <RequestDetailsTab />}
    </div>
  );
}
