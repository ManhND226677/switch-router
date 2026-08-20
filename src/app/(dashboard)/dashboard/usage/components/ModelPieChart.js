"use client";

import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);

// Premium palette derived from primary brand color and complementary neutral/dark tones
const COLORS = ["#5C8DFF", "#1D232A", "#64748B", "#94A3B8", "#CBD5E1", "#F1F5F9"];

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

export default function ModelPieChart({ modelData }) {
  if (!modelData?.length) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-sm">
        No model data
      </div>
    );
  }

  return (
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
        <RechartsTooltip content={<CustomPieTooltip />} cursor={{ fill: "transparent" }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
