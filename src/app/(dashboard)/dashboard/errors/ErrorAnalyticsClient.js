"use client";

// Failure analytics over the recent requestDetails window: failure rate,
// per-day burst, the top recurring upstream error signatures and the last
// failures. requestDetails keeps only the last N records (observabilityMax-
// Records), so this answers "what is breaking right now", not all time.

import { useCallback, useEffect, useState } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Select from "@/shared/components/Select";
import Input from "@/shared/components/Input";
import { CardSkeleton } from "@/shared/components";

const GROUP_OPTIONS = [
  { value: "provider:model", label: "Provider / Model" },
  { value: "provider", label: "Provider only" },
  { value: "model", label: "Model only" },
];

const POLL_INTERVAL_MS = 30000;
const todayIso = () => new Date().toISOString().slice(0, 10);
const fmtMs = (n) => (n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`);
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString() : "—");

function StatCard({ label, value, sub, tone = "default" }) {
  return (
    <Card padding="sm" className="min-w-0">
      <div className="text-2xl font-bold text-text-main truncate">{value}</div>
      <div className="text-xs text-text-muted mt-0.5">{label}</div>
      {sub && <div className={`text-xs mt-1 ${tone === "bad" ? "text-red-500" : "text-text-muted"}`}>{sub}</div>}
    </Card>
  );
}

function Bars({ rows, labelKey, valueKey }) {
  const max = Math.max(...rows.map((r) => r[valueKey]), 1);
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r[labelKey]} className="flex items-center gap-3 text-sm min-w-0">
          <span className="w-28 shrink-0 truncate text-text-muted font-mono text-xs">{r[labelKey]}</span>
          <span className="flex-1 h-2 rounded-full bg-bg-alt overflow-hidden">
            <span
              className="block h-full rounded-full bg-red-500/70"
              style={{ width: `${Math.round((r[valueKey] / max) * 100)}%` }}
            />
          </span>
          <span className="w-10 shrink-0 text-right font-mono text-xs text-text-main">{r[valueKey]}</span>
        </div>
      ))}
    </div>
  );
}

function GroupTable({ rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-text-muted">
            <th className="pb-2 font-medium">Provider / Model</th>
            <th className="pb-2 font-medium text-right">Errors</th>
            <th className="pb-2 font-medium text-right">Avg latency</th>
            <th className="pb-2 font-medium text-right">Status</th>
            <th className="pb-2 font-medium text-right">Last seen</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const label = [r.provider, r.model].filter(Boolean).join(" / ");
            const status = r.minStatus == null ? "—"
              : r.maxStatus === r.minStatus ? String(r.minStatus)
                : `${r.minStatus}–${r.maxStatus}`;
            return (
              <tr key={`${label}-${i}`} className="border-t border-border-subtle">
                <td className="py-2 pr-2 font-mono text-xs text-text-main truncate max-w-[28ch]">{label}</td>
                <td className="py-2 text-right font-mono text-xs text-red-500">{r.errors}</td>
                <td className="py-2 text-right font-mono text-xs text-text-muted">{fmtMs(r.avgMs)}</td>
                <td className="py-2 text-right font-mono text-xs text-text-muted">{status}</td>
                <td className="py-2 text-right text-xs text-text-muted whitespace-nowrap">{fmtDateTime(r.lastTs)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SignatureList({ rows }) {
  return (
    <div className="flex flex-col divide-y divide-border-subtle">
      {rows.map((s, i) => (
        <div key={`${s.status}-${i}`} className="flex items-start gap-3 py-2 text-sm min-w-0">
          <span className="shrink-0 font-mono text-xs px-1.5 py-0.5 rounded bg-bg-alt text-text-main">
            {s.status || "—"}
          </span>
          <span className="flex-1 min-w-0 text-text-main break-words">
            {s.message || "(no message from upstream)"}
          </span>
          <span className="shrink-0 font-mono text-xs text-red-500">×{s.count}</span>
        </div>
      ))}
    </div>
  );
}

function RecentList({ rows }) {
  return (
    <div className="flex flex-col divide-y divide-border-subtle">
      {rows.map((r) => (
        <div key={r.id} className="py-2 text-sm min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-mono text-xs text-text-muted">{fmtDateTime(r.timestamp)}</span>
            <span className="font-mono text-xs text-text-main">{[r.provider, r.model].filter(Boolean).join(" / ")}</span>
            {r.statusCode ? <span className="font-mono text-xs text-red-500">{r.statusCode}</span> : null}
            <span className="font-mono text-xs text-text-muted">{fmtMs(r.totalMs)}</span>
          </div>
          <div className="text-xs text-text-muted mt-0.5 break-words">
            {r.errorMessage || "(no message from upstream)"}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ErrorAnalyticsClient() {
  const [filters, setFilters] = useState({ groupBy: "provider:model", startDate: "", endDate: "", recentLimit: "20" });
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ groupBy: filters.groupBy, recentLimit: filters.recentLimit || "20" });
      if (filters.startDate) params.set("startDate", filters.startDate);
      if (filters.endDate) params.set("endDate", filters.endDate);

      const res = await fetch(`/api/usage/errors?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Error analytics failed (${res.status})`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; the flag drives the first-render skeleton
    load();
  }, [load]);

  // Poll so freshly failed requests appear while the page stays open.
  useEffect(() => {
    const id = setInterval(() => { load({ silent: true }); }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  const setFilter = (patch) => setFilters((prev) => ({ ...prev, ...patch }));

  const totals = data?.totals;
  const avgErrorMs = totals?.totalErrors ? Math.round(totals.errorLatencyMs / totals.totalErrors) : null;
  const failureRate = totals ? Math.round((100 - totals.successRate) * 10) / 10 : null;
  const worst = data?.byGroup?.[0];
  const periodLabel = filters.startDate || filters.endDate
    ? `${filters.startDate || "…"} → ${filters.endDate || "…"}`
    : "All recorded requests";

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card padding="md">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            label="Group by"
            options={GROUP_OPTIONS}
            value={filters.groupBy}
            onChange={(e) => setFilter({ groupBy: e.target.value })}
          />
          <Input
            label="Start date"
            type="date"
            value={filters.startDate}
            onChange={(e) => setFilter({ startDate: e.target.value })}
          />
          <Input
            label="End date"
            type="date"
            value={filters.endDate}
            onChange={(e) => setFilter({ endDate: e.target.value })}
          />
          <Input
            label="Recent rows"
            type="number"
            min="1"
            max="100"
            value={filters.recentLimit}
            onChange={(e) => setFilter({ recentLimit: e.target.value })}
            inputClassName="font-mono"
          />
        </div>
        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <Button size="sm" variant="secondary" icon="today" onClick={() => setFilter({ startDate: todayIso(), endDate: todayIso() })}>
            Today
          </Button>
          <Button size="sm" variant="ghost" icon="restart_alt" onClick={() => setFilter({ startDate: "", endDate: "" })}>
            Clear dates
          </Button>
          <Button size="sm" variant="outline" icon="refresh" loading={loading} onClick={() => load()}>
            Refresh
          </Button>
          <span className="text-xs text-text-muted ml-auto">{periodLabel}</span>
        </div>
      </Card>

      {error ? (
        <Card padding="sm">
          <div className="flex items-center gap-2 text-sm text-red-500">
            <span className="material-symbols-outlined text-lg">error</span>
            {error.message}
          </div>
        </Card>
      ) : null}

      {loading && !data ? (
        <CardSkeleton />
      ) : !data ? null : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Failure rate" value={`${failureRate}%`} sub={`${totals.totalErrors} of ${totals.totalRequests} requests`} tone={failureRate > 0 ? "bad" : "default"} />
            <StatCard label="Total errors" value={totals.totalErrors} sub={periodLabel} />
            <StatCard label="Avg failed-call latency" value={fmtMs(avgErrorMs)} sub="Time wasted on failures" />
            <StatCard
              label="Worst target"
              value={worst ? [worst.provider, worst.model].filter(Boolean).join(" / ") : "—"}
              sub={worst ? `${worst.errors} errors` : "No failures in period"}
            />
          </div>

          <Card padding="md" title="Top error signatures" icon="warning">
            {data.signatures?.length ? <SignatureList rows={data.signatures} /> : <p className="text-sm text-text-muted">No failures in the selected period.</p>}
          </Card>

          <Card padding="md" title="Errors per day" icon="monitoring">
            {data.byDay?.length ? <Bars rows={data.byDay} labelKey="day" valueKey="errors" /> : <p className="text-sm text-text-muted">No failures in the selected period.</p>}
          </Card>

          <Card padding="md" title={`Errors by ${filters.groupBy.replace(":", " / ")}`} icon="overview">
            {data.byGroup?.length ? <GroupTable rows={data.byGroup} /> : <p className="text-sm text-text-muted">No failures in the selected period.</p>}
          </Card>

          <Card padding="md" title={`Recent errors (${data.recent.length})`} icon="schedule">
            {data.recent.length ? <RecentList rows={data.recent} /> : <p className="text-sm text-text-muted">Nothing failed — all green.</p>}
          </Card>
        </>
      )}
    </div>
  );
}
