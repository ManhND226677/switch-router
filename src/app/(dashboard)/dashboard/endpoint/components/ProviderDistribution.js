"use client";

// Provider distribution: share bar (requests per provider) + ranked list.
// Daily rollups keep no per-provider success flag, so the share is by request
// count — success-rate-per-provider would need a new rollup field.
import Card from "@/shared/components/Card";

const PROVIDER_COLORS = ["#5C8DFF", "#34a853", "#a78bfa", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899"];

export default function ProviderDistribution({ byProvider = {} }) {
  const entries = Object.entries(byProvider)
    .map(([id, p]) => ({ id, requests: p.requests || 0, tokens: (p.promptTokens || 0) + (p.completionTokens || 0) }))
    .sort((a, b) => b.requests - a.requests);

  const total = entries.reduce((sum, e) => sum + e.requests, 0);
  const hasData = total > 0;

  return (
    <Card className="flex min-w-0 flex-col gap-4 p-4 h-full">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-text-main">Provider distribution</h3>
        {hasData && (
          <span className="text-sm text-text-muted">
            <strong className="text-text-main">{total}</strong> requests
          </span>
        )}
      </div>

      {!hasData ? (
        <div className="flex-1 min-h-[160px] flex items-center justify-center text-text-muted text-sm">No data for this period</div>
      ) : (
        <>
          {/* Segmented share bar */}
          <div className="flex h-9 w-full overflow-hidden rounded-lg gap-0.5" role="img" aria-label="Provider request share">
            {entries.map((e, i) => {
              const pct = (e.requests / total) * 100;
              if (pct <= 0) return null;
              return (
                <div
                  key={e.id}
                  className="h-full first:rounded-l-lg last:rounded-r-lg"
                  style={{ width: `${pct}%`, backgroundColor: PROVIDER_COLORS[i % PROVIDER_COLORS.length], opacity: i === 0 ? 1 : 0.85 }}
                  title={`${e.id}: ${Math.round(pct)}%`}
                />
              );
            })}
          </div>

          {/* Ranked list */}
          <div className="flex flex-col divide-y divide-border-subtle">
            {entries.map((e, i) => (
              <div key={e.id} className="flex items-center gap-3 py-2.5 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: PROVIDER_COLORS[i % PROVIDER_COLORS.length] }} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-main truncate">{e.id}</p>
                  <p className="text-xs text-text-muted truncate">{fmtTokens(e.tokens)} tokens</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-text-main">{e.requests}</p>
                  <p className="text-xs text-text-muted">{Math.round((e.requests / total) * 100)}%</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function fmtTokens(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n || 0);
}
