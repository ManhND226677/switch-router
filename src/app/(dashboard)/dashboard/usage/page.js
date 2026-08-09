"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CardSkeleton, SegmentedControl } from "@/shared/components";
import Card from "@/shared/components/Card";
import RequestDetailsTab from "./components/RequestDetailsTab";
import UsageChart from "./components/UsageChart";
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from "recharts";
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

function timeAgo(timestamp) {
  const diff = Math.floor((Date.now() - new Date(timestamp)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function TimeAgo({ timestamp }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
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

function OverviewDashboard({ period }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modelNames, setModelNames] = useState({});

  useEffect(() => {
    let isMounted = true;
    
    async function fetchData() {
      setLoading(true);
      try {
        const [r, names] = await Promise.all([
          fetch(`/api/usage/stats?period=${period}`),
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

    return () => {
      isMounted = false;
    };
  }, [period]);

  useEffect(() => {
    const es = new EventSource("/api/usage/stream");
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setStats((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            recentRequests: data.recentRequests,
          };
        });
      } catch (err) {}
    };
    return () => es.close();
  }, []);

  if (loading && !stats) return <CardSkeleton />;
  if (!stats) return <div className="text-text-muted">Failed to load dashboard data.</div>;

  const tokensProcessed = (stats.totalPromptTokens || 0) + (stats.totalCompletionTokens || 0);

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

  const CustomPieTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-surface border border-border shadow-md rounded-lg p-3 min-w-[120px]">
          {payload.map((entry, index) => (
            <div key={index} className="flex flex-col gap-1">
              <div className="flex items-center gap-2 mb-1">
                <div 
                  className="w-2.5 h-2.5 rounded-sm" 
                  style={{ backgroundColor: entry.color }}
                />
                <span className="text-xs font-medium text-text-muted">{entry.name}</span>
              </div>
              <span className="text-sm font-semibold text-text-main ml-4">
                {fmt(entry.value)} <span className="text-text-muted font-normal text-xs">Tokens</span>
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-300">
      {/* Metrics Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Total Requests" value={fmt(stats.totalRequests)} trend="+12.5%" trendUp={true} />
        <MetricCard title="Tokens Processed" value={fmt(tokensProcessed)} trend="+8.2%" trendUp={true} />
        <MetricCard title="Avg Latency" value="245ms" trend="-15ms" trendUp={true} />
        <MetricCard title="Est. Cost" value={fmtCost(stats.totalCost)} trend="-$2.40" trendUp={false} />
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
                    <Legend 
                      verticalAlign="bottom" 
                      height={36} 
                      iconType="circle"
                      wrapperStyle={{ fontSize: "12px", color: "var(--color-text-muted)" }}
                    />
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
                    <td className="px-6 py-3 text-text-muted">{r.provider || "N/A"}</td>
                    <td className="px-6 py-3 text-right whitespace-nowrap">
                      <span className="text-primary">{fmt(r.promptTokens)}</span>
                      <span className="text-text-muted/50 mx-1.5">/</span>
                      <span className="text-success">{fmt(r.completionTokens)}</span>
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

  const [period, setPeriod] = useState("today");

  const tabFromUrl = searchParams.get("tab");
  const activeTab = tabFromUrl && ["overview", "logs"].includes(tabFromUrl)
    ? tabFromUrl
    : "overview";

  const handleTabChange = (value) => {
    if (value === activeTab) return;
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
