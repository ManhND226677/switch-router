"use client";

// Combined usage trend: Billing bars ($, right axis) + Tokens line (left
// axis) + dashed Requests line. Mirrors the workbench-style dashboard look.
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const fmtTokens = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n || 0);
};

const TrendTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface border border-border shadow-md rounded-lg p-3">
      <p className="text-text-muted text-xs mb-2 font-medium">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color || entry.stroke }} />
          <span className="text-sm font-semibold text-text-main">
            {entry.name}: {entry.name === "Billing" ? `$${Number(entry.value).toFixed(4)}` : fmtTokens(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
};

export default function UsageTrendChart({ data = [] }) {
  const hasData = data.some((d) => d.tokens > 0 || d.cost > 0 || d.requests > 0);

  return (
    <div className="flex min-w-0 flex-col gap-3 h-full">
      <h3 className="font-semibold text-text-main">Usage trend</h3>
      {!hasData ? (
        <div className="flex-1 min-h-[220px] flex items-center justify-center text-text-muted text-sm">
          No data for this period
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradBilling" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#34a853" stopOpacity={0.55} />
                <stop offset="95%" stopColor="#34a853" stopOpacity={0.15} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" strokeOpacity={0.4} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "var(--color-text-muted)" }}
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              interval="preserveStartEnd"
            />
            <YAxis yAxisId="tokens" tick={{ fontSize: 11, fill: "var(--color-text-muted)" }} tickLine={false} axisLine={false} width={44} tickFormatter={fmtTokens} />
            <YAxis yAxisId="cost" orientation="right" tick={{ fontSize: 11, fill: "var(--color-text-muted)" }} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `$${v}`} />
            <Tooltip content={<TrendTooltip />} cursor={{ fill: "var(--color-bg-subtle)", opacity: 0.4 }} />
            <Bar yAxisId="cost" dataKey="cost" name="Billing" fill="url(#gradBilling)" radius={[3, 3, 0, 0]} maxBarSize={22} />
            <Line yAxisId="tokens" type="monotone" dataKey="tokens" name="Tokens" stroke="var(--color-brand-500, #5C8DFF)" strokeWidth={2} dot={false} />
            <Line yAxisId="tokens" type="monotone" dataKey="requests" name="Requests" stroke="var(--color-text-muted, #9ca3af)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
      {/* Legend */}
      <div className="flex items-center justify-center gap-6 text-xs text-text-muted">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#34a853]/70 inline-block" /> Billing</span>
        <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-brand-500 inline-block" /> Tokens</span>
        <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-text-muted inline-block" /> Requests</span>
      </div>
    </div>
  );
}
