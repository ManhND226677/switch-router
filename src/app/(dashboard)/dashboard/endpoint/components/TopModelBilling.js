"use client";

// Top models by billing: ranked table (cost desc) with tokens + requests.
import Card from "@/shared/components/Card";

const fmtTokens = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n || 0);
};

export default function TopModelBilling({ byModel = {}, topN = 10, modelNames = {} }) {
  const rows = Object.entries(byModel)
    .map(([key, m]) => ({
      key,
      rawModel: m.rawModel || key.split(" (")[0],
      provider: m.provider || "",
      cost: m.cost || 0,
      promptTokens: m.promptTokens || 0,
      completionTokens: m.completionTokens || 0,
      cachedTokens: m.cachedTokens || 0,
      requests: m.requests || 0,
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, topN);

  const hasData = rows.some((r) => r.cost > 0 || r.requests > 0);

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4 h-full">
      <h3 className="font-semibold text-text-main">Top {topN} model billing</h3>

      {!hasData ? (
        <div className="flex-1 min-h-[160px] flex items-center justify-center text-text-muted text-sm">No data for this period</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-text-muted uppercase text-xs border-b border-border-subtle">
              <tr>
                <th className="py-2 pr-3 font-semibold">Model</th>
                <th className="py-2 px-3 font-semibold text-right">Billing</th>
                <th className="py-2 px-3 font-semibold text-right">Tokens</th>
                <th className="py-2 pl-3 font-semibold text-right">Requests</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle/60">
              {rows.map((r) => {
                const display = modelNames[r.rawModel] || r.rawModel;
                const totalTokens = r.promptTokens + r.completionTokens;
                return (
                  <tr key={r.key} className="hover:bg-bg-subtle/30 transition-colors">
                    <td className="py-2.5 pr-3 min-w-0">
                      <p className="font-medium text-text-main truncate">{display}</p>
                      {r.provider && <p className="text-xs text-text-muted truncate">{r.provider}</p>}
                      {(r.promptTokens > 0 || r.completionTokens > 0) && (
                        <p className="text-xs text-text-muted/80 font-mono truncate">
                          In {fmtTokens(r.promptTokens)} · Out {fmtTokens(r.completionTokens)}
                          {r.cachedTokens > 0 ? ` · ↻${fmtTokens(r.cachedTokens)}` : ""}
                        </p>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-medium text-success whitespace-nowrap">
                      ${Number(r.cost).toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-text-main whitespace-nowrap">{fmtTokens(totalTokens)}</td>
                    <td className="py-2.5 pl-3 text-right font-mono text-primary whitespace-nowrap">{r.requests}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
