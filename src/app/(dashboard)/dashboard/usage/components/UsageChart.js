"use client";

import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import Card from "@/shared/components/Card";

const fmtTokens = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n || 0);
};

const fmtCost = (n) => `$${(n || 0).toFixed(4)}`;

const CustomTooltip = ({ active, payload, label, formatter }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-surface border border-border shadow-md rounded-lg p-3">
        <p className="text-text-muted text-xs mb-2 font-medium">{label}</p>
        {payload.map((entry, index) => {
          const [formattedValue, name] = formatter(entry.value, entry.name);
          return (
            <div key={index} className="flex items-center gap-2">
              <div 
                className="w-2 h-2 rounded-full" 
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-sm font-semibold text-text-main">
                {name}: {formattedValue}
              </span>
            </div>
          );
        })}
      </div>
    );
  }
  return null;
};

export default function UsageChart({ period = "7d", statsVersion = null }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState("tokens");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/usage/chart?period=${period}&_t=${Date.now()}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.error("Failed to fetch chart data:", e);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount/version bump; state updates only after the response resolves
    fetchData();

    // statsVersion bumps (from the usage SSE stream) drive real updates; this
    // slow fallback only keeps time-windowed buckets fresh while the tab idles.
    const fallback = setInterval(fetchData, 60000);
    return () => clearInterval(fallback);
  }, [fetchData, statsVersion]);

  const hasData = data.some((d) => d.tokens > 0 || d.cost > 0);

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-3 sm:p-4 h-full min-h-[300px]">
      <div className="grid w-full grid-cols-2 items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1 sm:w-auto sm:self-start">
        <button
          onClick={() => setViewMode("tokens")}
          className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${viewMode === "tokens" ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text hover:bg-bg-hover"}`}
        >
          Tokens
        </button>
        <button
          onClick={() => setViewMode("cost")}
          className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${viewMode === "cost" ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text hover:bg-bg-hover"}`}
        >
          Cost
        </button>
      </div>

      {loading ? (
        <div className="h-48 flex items-center justify-center text-text-muted text-sm">Loading...</div>
      ) : !hasData ? (
        <div className="h-48 flex items-center justify-center text-text-muted text-sm">No data for this period</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradPrimary" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#5C8DFF" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#5C8DFF" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" strokeOpacity={0.4} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "var(--color-text-muted)" }}
              tickLine={false}
              axisLine={false}
              tickMargin={12}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--color-text-muted)" }}
              tickLine={false}
              axisLine={false}
              tickMargin={12}
              tickFormatter={viewMode === "tokens" ? fmtTokens : fmtCost}
              width={50}
            />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ stroke: 'var(--color-border)', strokeWidth: 1, strokeDasharray: '4 4' }}
              formatter={(value, name) =>
                name === "tokens" ? [fmtTokens(value), "Tokens"] : [fmtCost(value), "Cost"]
              }
            />
            {viewMode === "tokens" ? (
              <Area
                type="monotone"
                dataKey="tokens"
                stroke="#5C8DFF"
                strokeWidth={2}
                fill="url(#gradPrimary)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0, fill: "#5C8DFF" }}
              />
            ) : (
              <Area
                type="monotone"
                dataKey="cost"
                stroke="#5C8DFF"
                strokeWidth={2}
                fill="url(#gradPrimary)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0, fill: "#5C8DFF" }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

UsageChart.propTypes = {
  period: PropTypes.string,
  statsVersion: PropTypes.number,
};
