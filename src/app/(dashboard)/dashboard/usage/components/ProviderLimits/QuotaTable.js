"use client";

import { useEffect, useMemo, useState } from "react";
import { formatResetTime, getRemainingPercentage } from "./utils";

const PAGE_SIZE = 10;

/**
 * Format reset time display (Today, 12:00 PM)
 */
function formatResetTimeDisplay(resetTime) {
  if (!resetTime) return null;

  try {
    const date = new Date(resetTime);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let dayStr = "";
    if (date >= today && date < tomorrow) {
      dayStr = "Today";
    } else if (date >= tomorrow && date < new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000)) {
      dayStr = "Tomorrow";
    } else {
      dayStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }

    const timeStr = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    return `${dayStr}, ${timeStr}`;
  } catch {
    return null;
  }
}

/**
 * Get color classes based on remaining percentage
 */
function getColorClasses(remainingPercentage) {
  if (remainingPercentage === null) {
    return {
      text: "text-text-muted",
      bg: "bg-black/20 dark:bg-white/20",
      bgLight: "bg-black/5 dark:bg-white/5",
      dot: "bg-black/20 dark:bg-white/20",
    };
  }

  if (remainingPercentage > 70) {
    return {
      text: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-500",
      bgLight: "bg-emerald-500/10",
      dot: "bg-emerald-500",
    };
  }

  if (remainingPercentage >= 30) {
    return {
      text: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-500",
      bgLight: "bg-amber-500/10",
      dot: "bg-amber-500",
    };
  }

  return {
    text: "text-rose-600 dark:text-rose-400",
    bg: "bg-rose-500",
    bgLight: "bg-rose-500/10",
    dot: "bg-rose-500 animate-pulse",
  };
}

function sortQuotas(quotas, sortMode) {
  if (sortMode === "remaining-asc") {
    return [...quotas].sort((a, b) => (a.remaining === null ? 1 : b.remaining === null ? -1 : a.remaining - b.remaining) || a.name.localeCompare(b.name));
  }

  if (sortMode === "remaining-desc") {
    return [...quotas].sort((a, b) => (a.remaining === null ? 1 : b.remaining === null ? -1 : b.remaining - a.remaining) || a.name.localeCompare(b.name));
  }

  return quotas;
}

/**
 * Quota Table Component - Table-based display for quota data
 */
export default function QuotaTable({
  quotas = [],
  compact = false,
  sortMode = "default",
  showSortLabel = false,
  onHideQuota = null,
}) {
  const [page, setPage] = useState(1);

  const normalizedQuotas = useMemo(
    () => quotas.map((quota, index) => ({
      ...quota,
      index,
      remaining: getRemainingPercentage(quota),
    })),
    [quotas],
  );

  const sortedQuotas = useMemo(
    () => sortQuotas(normalizedQuotas, sortMode),
    [normalizedQuotas, sortMode],
  );

  const totalPages = Math.max(1, Math.ceil(sortedQuotas.length / PAGE_SIZE));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset to the first page when the sort or data changes
    setPage(1);
  }, [sortMode, quotas]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clamp the page to the new total page count
    setPage((currentPage) => Math.min(currentPage, totalPages));
  }, [totalPages]);

  if (!quotas || quotas.length === 0) {
    return null;
  }

  const currentPageRows = sortedQuotas.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );
  const pageStart = sortedQuotas.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(page * PAGE_SIZE, sortedQuotas.length);

  const cellPad = compact ? "py-1 px-1.5" : "py-2 px-3";
  const nameText = compact ? "text-xs" : "text-sm";
  const resetPrimary = compact ? "text-xs" : "text-sm";
  const resetSecondary = compact ? "text-xs leading-tight" : "text-xs";
  const sortLabel = "Sorted by account remaining";
  const hasHideAction = typeof onHideQuota === "function";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-text-muted">
          {sortedQuotas.length} quota{sortedQuotas.length > 1 ? "s" : ""}
        </div>
        {showSortLabel && (
          <div className="rounded-md border border-black/10 bg-black/[0.02] px-2 py-1 text-xs text-text-muted dark:border-white/10 dark:bg-white/[0.03]">
            {sortLabel}
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-left">
          <tbody>
            {currentPageRows.map((quota) => {
              const colors = getColorClasses(quota.remaining);
              const hasPercentage = quota.remaining !== null;
              const countdown = formatResetTime(quota.resetAt);
              const resetDisplay = formatResetTimeDisplay(quota.resetAt);
              // recurring defaults true: a missing flag means the quota
              // refreshes at resetAt. Bonus/one-shot packs set recurring:false
              // and their resetAt is a hard expiry, so word it as "expires".
              const recurring = quota.recurring !== false;
              const countdownLabel = recurring ? `in ${countdown}` : `expires in ${countdown}`;

              return (
                <tr
                  key={`${quota.name}-${quota.index}`}
                  className="border-b border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
                >
                  <td className={`${cellPad} w-[20%]`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${colors.dot}`}></span>
                      <span className={`${nameText} font-medium text-text-primary capitalize truncate`}>
                        {quota.category || "General"}
                      </span>
                    </div>
                  </td>

                  <td className={`${cellPad} w-[55%]`}>
                    <div className={compact ? "space-y-1.5" : "space-y-2"}>
                      <div className={`flex items-center justify-between ${compact ? "text-xs" : "text-sm"} mb-1`}>
                        <span className="font-semibold text-text-primary truncate mr-2">
                          {quota.name}
                        </span>
                        <span className={`font-bold ${colors.text} shrink-0`}>
                          {hasPercentage ? `${quota.remaining}%` : "No limit"}
                        </span>
                      </div>
                      
                      {hasPercentage && (
                        <div className={`${compact ? "h-2.5" : "h-3"} rounded-full overflow-hidden border ${colors.bgLight} ${
                          quota.remaining === 0 ? "border-black/10 dark:border-white/10" : "border-transparent"
                        }`}>
                          <div
                            className={`h-full transition-all duration-300 ${colors.bg}`}
                            style={{ width: `${Math.min(quota.remaining, 100)}%` }}
                          />
                        </div>
                      )}

                      <div className="flex items-center justify-between text-xs text-text-muted mt-1">
                        <span>
                          {quota.displayValue || `${quota.used.toLocaleString()} used`}
                        </span>
                        <span>
                          {quota.total > 0 ? quota.total.toLocaleString() : "∞"} total
                        </span>
                      </div>
                    </div>
                  </td>

                  <td className={`${cellPad} ${hasHideAction ? "w-[20%]" : "w-[25%]"}`}>
                    {countdown !== "-" || resetDisplay ? (
                      compact ? (
                        <div className="flex flex-col space-y-0.5">
                          {countdown !== "-" && (
                            <span className={`${resetPrimary} font-medium ${quota.remaining <= 30 ? 'text-amber-600 dark:text-amber-400' : 'text-text-primary'}`}>
                              {countdownLabel}
                            </span>
                          )}
                          {resetDisplay && (
                            <span className={`${resetSecondary} text-text-muted truncate`} title={resetDisplay || ""}>
                              {resetDisplay}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {countdown !== "-" && (
                            <div className={`${resetPrimary} font-medium ${quota.remaining <= 30 ? 'text-amber-600 dark:text-amber-400' : 'text-text-primary'}`}>
                              {countdownLabel}
                            </div>
                          )}
                          {resetDisplay && (
                            <div className={`${resetSecondary} text-text-muted flex items-center gap-1`}>
                              <span className="material-symbols-outlined text-[14px]">event</span>
                              {resetDisplay}
                            </div>
                          )}
                        </div>
                      )
                    ) : (
                      <div className={`${resetPrimary} text-text-muted italic`}>N/A</div>
                    )}
                  </td>

                  {hasHideAction && (
                    <td className={`${cellPad} w-[5%] text-right`}>
                      <button
                        type="button"
                        onClick={() => onHideQuota(quota)}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/5"
                        title="Hide this quota row"
                        aria-label={`Hide quota ${quota.name}`}
                      >
                        <span className="material-symbols-outlined text-base">
                          visibility_off
                        </span>
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="rounded-md border border-black/10 bg-black/[0.02] px-2 py-1.5 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
            <span>
              Showing {pageStart}-{pageEnd} of {sortedQuotas.length}
            </span>
            <span>
              Page {page} / {totalPages}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
              disabled={page === 1}
              className="flex h-6 items-center rounded-md border border-black/10 px-2 text-xs text-text-primary transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))}
              disabled={page === totalPages}
              className="flex h-6 items-center rounded-md border border-black/10 px-2 text-xs text-text-primary transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
