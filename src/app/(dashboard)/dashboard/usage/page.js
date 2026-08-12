"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CardSkeleton, SegmentedControl } from "@/shared/components";
import Card from "@/shared/components/Card";
import RequestDetailsTab from "./components/RequestDetailsTab";
import UsageChart from "./components/UsageChart";
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";
import { fetchModelNames, getModelName } from "@/shared/utils/modelNames";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
];

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(4)}`;
const fmtLatency = (ms) => {
  if (!ms || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

function timeAgo(timestamp) {
  if (!timestamp) return "—";
  const diff = Math.floor((Date.now() - new Date(timestamp)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function TimeAgo({ timestamp }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, []);
  return <>{timeAgo(timestamp)}</>;
}

function MetricCard({ title, value, trend, trendUp }) {
  return (
    <Card className="flex min-w-0 flex-col p-5 h-full justify-between" padding="none" hover>
      <div className="flex items-center justify-between mb-4">
        <span className="text-text-muted text-sm font-medium">{title}</span>
        {trend && (
          <span className={`text-xs font-semibold px-2 py-1 rounded-md ${trendUp ? "bg-success/10 text-success" : "bg-error/10 text-error"}`}>
            {trend}
          </span>
        )}
      </div>
      <div className="text-3xl font-bold text-text-main truncate tracking-tight">{value}</div>
    </Card>
  );
}

function CustomPieTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="min-w-[180px] max-w-[280px] rounded-lg border border-border bg-surface p-3 shadow-lg">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        Model usage
      </div>
      <div className="flex flex-col gap-2">
        {payload.map((entry, index) => {
          const modelName = entry.payload?.name || entry.name || "Unknown model";
          return (
            <div key={`${modelName}-${index}`} className="flex items-start gap-2">
              <span
                className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <div className="min-w-0">
                <div className="break-words text-xs font-medium text-text-main">
                  {modelName}
                </div>
                <div className="text-xs text-text-muted">
                  {fmt(entry.value)} tokens
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function OverviewDashboard({ period }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modelNames, setModelNames] = useState({});

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
    let isFirstCall = true;

    async function fetchData() {
      if (isFirstCall) {
        setLoading(true);
        isFirstCall = false;
      }
      try {
        const [r, names] = await Promise.all([
          fetch(`/api/usage/stats?period=${period}&_t=${Date.now()}`),
          fetchModelNames()
        ]);
        const data = r.ok ? await r.json() : null;
        if (isMounted) {
          if (data) setStats(data);
          setModelNames(names);
          setLoading(false);
        }
      } catch (error) {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchData();

    const poll = setInterval(fetchData, 10000);

    return () => {
      isMounted = false;
      clearInterval(poll);
    };
  }, [period]);

  // SSE delivers only the live slices (recentRequests, activeRequests,
  // errorProvider) — period-scoped totals are refreshed by the stats poll
  // above so every value always matches the selected period.
  useEffect(() => {
    const es = new EventSource("/api/usage/stream");
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setStats((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            activeRequests: data.activeRequests,
            recentRequests: data.recentRequests,
            errorProvider: data.errorProvider,
          };
        });
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

  // Use a premium, sleek palette derived from primary brand color and complementary neutral/dark tones
  const COLORS = ["#E56A4A", "#1D232A", "#64748B", "#94A3B8", "#CBD5E1", "#F1F5F9"];

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-300">
      {/* Metrics Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard title="Total Requests" value={fmt(stats.totalRequests)} />
        <MetricCard title="Input Tokens" value={fmt(stats.totalPromptTokens)} />
        <MetricCard
          title="Cache Tokens"
          value={stats.totalCachedTokens > 0 ? fmt(stats.totalCachedTokens) : "0"}
          trend={stats.totalCachedTokens > 0 ? "↻" : undefined}
        />
        <MetricCard title="Output Tokens" value={fmt(stats.totalCompletionTokens)} />
        <MetricCard title="Avg Latency" value={fmtLatency(stats.avgLatencyMs)} />
        <MetricCard title="Est. Cost" value={fmtCost(stats.totalCost)} />
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <UsageChart period={period} />
        </div>
        <div className="lg:col-span-1">
          <Card className="flex min-w-0 flex-col gap-3 p-3 sm:p-4 h-full">
            <div className="flex items-center h-[32px] px-1">
              <h3 className="font-semibold text-text-main text-sm">Model Usage</h3>
            </div>
            <div className="flex-1 min-h-[220px]">
              {modelData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={modelData}
                      innerRadius={65}
                      outerRadius={85}
                      paddingAngle={4}
                      dataKey="value"
                      stroke="var(--color-surface)"
                      strokeWidth={2}
                    >
                      {modelData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip content={<CustomPieTooltip />} cursor={{fill: 'transparent'}} />

                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-text-muted text-sm">
                  No model data
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

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

export default function UsagePage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <UsageContent />
    </Suspense>
  );
}

function UsageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Default to a useful populated window. The local usage store can have no
  // entries for the current calendar day while still containing valid history;
  // opening on `today` made a healthy dashboard look empty after idle periods.
  const [period, setPeriod] = useState("7d");

  const tabFromUrl = searchParams.get("tab");
  const validTabFromUrl = tabFromUrl && ["overview", "logs"].includes(tabFromUrl) ? tabFromUrl : null;

  // State is the source of truth for the active tab — clicking always switches
  // immediately even if the URL update lags. URL seeds the initial value and is
  // kept in sync (back/forward, deep links) via render-phase adjustment.
  const [activeTab, setActiveTab] = useState(validTabFromUrl || "overview");
  const [prevTabFromUrl, setPrevTabFromUrl] = useState(tabFromUrl);
  if (tabFromUrl !== prevTabFromUrl) {
    setPrevTabFromUrl(tabFromUrl);
    if (validTabFromUrl) setActiveTab(validTabFromUrl);
  }

  const handleTabChange = (value) => {
    if (value === activeTab) return;
    setActiveTab(value);
    const params = new URLSearchParams(searchParams);
    params.set("tab", value);
    router.push(`/dashboard/usage?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Header and Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-surface p-4 rounded-xl border border-border shadow-sm">
        <SegmentedControl
          options={[
            { value: "overview", label: "Overview" },
            { value: "logs", label: "Logs" },
          ]}
          value={activeTab}
          onChange={handleTabChange}
          className="w-full sm:w-auto"
        />
        {activeTab === "overview" && (
          <SegmentedControl
            options={PERIODS}
            value={period}
            onChange={setPeriod}
            size="sm"
            className="w-full sm:w-auto"
          />
        )}
      </div>

      {activeTab === "overview" && (
        <Suspense fallback={<CardSkeleton />}>
          <OverviewDashboard period={period} />
        </Suspense>
      )}
      {activeTab === "logs" && <RequestDetailsTab />}
    </div>
  );
}
