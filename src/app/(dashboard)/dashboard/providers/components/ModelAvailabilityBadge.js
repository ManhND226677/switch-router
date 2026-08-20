"use client";

/**
 * ModelAvailabilityBadge — compact inline status indicator
 *
 * Shows green when all models are operational, or amber/red when there are
 * issues, with a hover popover for details and cooldown clearing.
 *
 * Account-level locks use model sentinel "__all" from the API — display as
 * "All models (account)" and count affected connections, not fake model ids.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

const STATUS_CONFIG = {
  available: { icon: "check_circle", color: "#22c55e", label: "Available" },
  cooldown: { icon: "schedule", color: "#f59e0b", label: "Cooldown" },
  unavailable: { icon: "error", color: "#ef4444", label: "Unavailable" },
  unknown: { icon: "help", color: "#6b7280", label: "Unknown" },
};

function formatIssueLabel(m) {
  if (m.label) return m.label;
  if (m.model === "__all" || m.scope === "account") return "All models (account)";
  return m.model || "Unknown";
}

function formatUntil(until) {
  if (!until) return null;
  try {
    const t = new Date(until).getTime() - Date.now();
    if (!Number.isFinite(t) || t <= 0) return "expired";
    const mins = Math.ceil(t / 60000);
    if (mins < 60) return `${mins}m left`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem ? `${hrs}h ${rem}m left` : `${hrs}h left`;
  } catch {
    return null;
  }
}

export default function ModelAvailabilityBadge() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [clearing, setClearing] = useState(null);
  const ref = useRef(null);
  const notifySuccess = useNotificationStore((s) => s.success);
  const notifyError = useNotificationStore((s) => s.error);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/models/availability");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // silent fail — will retry
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- poll status on mount
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setExpanded(false);
    };
    if (expanded) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [expanded]);

  const handleClear = async (m) => {
    const clearKey = `${m.connectionId || m.provider}:${m.model}`;
    setClearing(clearKey);
    try {
      const res = await fetch("/api/models/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "clearCooldown",
          provider: m.provider,
          model: m.model || "__all",
          connectionId: m.connectionId || undefined,
        }),
      });
      if (res.ok) {
        notifySuccess(`Cleared · ${formatIssueLabel(m)}`);
        await fetchStatus();
      } else {
        notifyError("Failed to clear issue");
      }
    } catch {
      notifyError("Failed to clear issue");
    } finally {
      setClearing(null);
    }
  };

  if (loading) return null;

  const models = data?.models || [];
  const issueCount = data?.unavailableCount ?? models.filter((m) => m.status !== "available").length;
  const connCount = data?.affectedConnections
    ?? new Set(models.map((m) => m.connectionId).filter(Boolean)).size;
  const isHealthy = issueCount === 0;

  const byProvider = {};
  models.forEach((m) => {
    if (m.status === "available") return;
    const key = m.provider || "unknown";
    if (!byProvider[key]) byProvider[key] = [];
    byProvider[key].push(m);
  });

  const badgeText = isHealthy
    ? "All models operational"
    : connCount > 0 && connCount !== issueCount
      ? `${issueCount} issue${issueCount !== 1 ? "s" : ""} · ${connCount} account${connCount !== 1 ? "s" : ""}`
      : `${issueCount} issue${issueCount !== 1 ? "s" : ""}`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
          isHealthy
            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/15"
            : "border-amber-500/20 bg-amber-500/10 text-amber-500 hover:bg-amber-500/15"
        }`}
        aria-expanded={expanded}
      >
        <span className="material-symbols-outlined text-sm">
          {isHealthy ? "verified" : "warning"}
        </span>
        {badgeText}
      </button>

      {expanded && (
        <div className="absolute top-full right-0 mt-2 w-96 max-w-[min(24rem,calc(100vw-2rem))] bg-surface border border-border rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg">
            <div className="flex items-center gap-2">
              <span
                className="material-symbols-outlined text-base"
                style={{ color: isHealthy ? "#22c55e" : "#f59e0b" }}
              >
                {isHealthy ? "verified" : "warning"}
              </span>
              <span className="text-sm font-semibold text-text-main">Model Status</span>
            </div>
            <button
              onClick={fetchStatus}
              className="p-1 rounded-lg hover:bg-surface text-text-muted hover:text-text-main transition-colors"
              title="Refresh"
              type="button"
            >
              <span className="material-symbols-outlined text-sm">refresh</span>
            </button>
          </div>

          <div className="px-4 py-3 max-h-72 overflow-y-auto">
            {isHealthy ? (
              <p className="text-sm text-text-muted text-center py-2">
                All models are responding normally.
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {Object.entries(byProvider).map(([provider, provModels]) => (
                  <div key={provider}>
                    <p className="text-xs font-semibold text-text-main mb-1.5 capitalize">{provider}</p>
                    <div className="flex flex-col gap-1.5">
                      {provModels.map((m) => {
                        const status = STATUS_CONFIG[m.status] || STATUS_CONFIG.unknown;
                        const clearKey = `${m.connectionId || m.provider}:${m.model}`;
                        const isClearing = clearing === clearKey;
                        const untilText = formatUntil(m.until);
                        const label = formatIssueLabel(m);
                        const canClear = m.status === "cooldown" || m.status === "unavailable";
                        return (
                          <div
                            key={`${m.connectionId || "x"}-${m.provider}-${m.model}-${m.status}`}
                            className="flex items-start justify-between gap-2 px-2.5 py-2 rounded-lg bg-surface/30"
                          >
                            <div className="flex items-start gap-1.5 min-w-0">
                              <span
                                className="material-symbols-outlined text-sm shrink-0 mt-0.5"
                                style={{ color: status.color }}
                              >
                                {status.icon}
                              </span>
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-text-main truncate">
                                  {label}
                                </div>
                                {m.connectionName && (
                                  <div className="text-[11px] text-text-muted truncate" title={m.connectionName}>
                                    {m.connectionName}
                                  </div>
                                )}
                                <div className="text-[11px] text-text-muted">
                                  {status.label}
                                  {untilText ? ` · ${untilText}` : ""}
                                </div>
                                {m.lastError && (
                                  <div className="text-[11px] text-red-500/90 mt-0.5 line-clamp-2" title={m.lastError}>
                                    {m.lastError}
                                  </div>
                                )}
                              </div>
                            </div>
                            {canClear && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleClear(m)}
                                disabled={isClearing}
                                className="text-xs px-1.5! py-0.5! ml-1 shrink-0"
                              >
                                {isClearing ? "..." : "Clear"}
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
