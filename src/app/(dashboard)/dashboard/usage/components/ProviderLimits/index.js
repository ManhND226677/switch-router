"use client";

import { useState, useEffect, useCallback, useRef, useMemo, memo } from "react";
import ProviderIcon from "@/shared/components/ProviderIcon";
import QuotaTable from "./QuotaTable";
import Toggle from "@/shared/components/Toggle";
import Tooltip from "@/shared/components/Tooltip";
import {
  parseQuotaData,
  calculatePercentage,
  filterQuotasByVisibility,
  getHiddenQuotaRows,
  getQuotaVisibilityKey,
  getConnectionLabel,
  getConnectionQuotaRemaining,
  sortVisibleConnections,
  buildLoadingState,
  filterQuotaStateByConnections,
  getConnectionsEmptyMessage,
  getPageSizeLabel,
  getConnectionsPaginationSummary,
  getSafePagination,
  getSafeTotals,
  shouldResetPage,
  getPaginationPageValue,
  getProviderOptions,
  reconcileConnectionsPage,
  getQuotaCache,
  setQuotaCache,
  removeQuotaCache,
  REFRESH_INTERVAL_MS,
  CLAUDE_REFRESH_INTERVAL_MS,
  QUOTA_CACHE_TTL_MS,
  QUOTA_REFRESH_CONCURRENCY,
  DEPLETED_QUOTA_THRESHOLD,
  AUTO_REFRESH_STORAGE_KEY,
  CONNECTIONS_PAGE_SIZE,
  ACCOUNT_PAGE_SIZE_OPTIONS,
  ACCOUNT_PAGE_SIZE_MAX,
  ACCOUNT_FILTER_OPTIONS,
  QUOTA_SORT_OPTIONS,
} from "./utils";
import Card from "@/shared/components/Card";
import { ConfirmModal, EditConnectionModal } from "@/shared/components";
import { USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";

const AUTO_PING_SETTINGS_KEYS = {
  claude: "claudeAutoPing",
  codex: "codexAutoPing",
};

const AUTO_PING_TOOLTIPS = {
  claude: "When your 5h quota runs out, auto-sends a request the moment it resets so a new window starts right away.",
  codex: "Auto-starts the next 5h Codex window after reset by sending a tiny gpt-5.5 request. Consumes a small amount of quota.",
};

function getConnectionSecondaryLabel(connection) {
  if (connection.name?.trim() && connection.email?.trim() && connection.name.trim() !== connection.email.trim()) {
    return connection.email.trim();
  }

  if (connection.name?.trim() && connection.displayName?.trim() && connection.name.trim() !== connection.displayName.trim()) {
    return connection.displayName.trim();
  }

  return null;
}

function getCodexResetCreditCount(quota) {
  const value = quota?.raw?.resetCredits?.availableCount;
  const count = typeof value === "number" ? value : Number(value);
  return Number.isFinite(count) ? Math.max(0, count) : 0;
}

function formatCreditDate(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "N/A";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTimeRemaining(value) {
  if (!value) return "N/A";
  const diffMs = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(diffMs)) return "N/A";
  if (diffMs <= 0) return "Expired";
  const totalHours = Math.ceil(diffMs / (60 * 60 * 1000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }));

  return results;
}

const RefreshCountdown = memo(function RefreshCountdown({ active }) {
  const [countdown, setCountdown] = useState(60);

  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => {
      setCountdown((previous) => (previous <= 1 ? 60 : previous - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [active]);

  return active ? <span className="text-xs text-text-muted tabular-nums">({countdown}s)</span> : null;
});

export default function ProviderLimits() {
  const [connections, setConnections] = useState([]);
  const [quotaData, setQuotaData] = useState({});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [autoPingMaps, setAutoPingMaps] = useState({ claude: {}, codex: {} });
  const [lastUpdated, setLastUpdated] = useState(null);
  const [hasHydratedAutoRefresh, setHasHydratedAutoRefresh] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [resettingLimitId, setResettingLimitId] = useState(null);
  const [resetConfirmState, setResetConfirmState] = useState(null);
  const [resetCreditsState, setResetCreditsState] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [proxyPools, setProxyPools] = useState([]);
  const [providerFilter, setProviderFilter] = useState("all");
  const [providerOptions, setProviderOptions] = useState([]);
  const [accountFilter, setAccountFilter] = useState("all");
  const [quotaSortMode, setQuotaSortMode] = useState("default");
  const [quotaVisibility, setQuotaVisibility] = useState({});
  const [expiringFirst, setExpiringFirst] = useState(false);
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const [bulkToggling, setBulkToggling] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(CONNECTIONS_PAGE_SIZE);
  const [customPageSizeInput, setCustomPageSizeInput] = useState(
    String(CONNECTIONS_PAGE_SIZE),
  );
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: CONNECTIONS_PAGE_SIZE,
    total: 0,
    totalPages: 1,
  });
  const [totals, setTotals] = useState({
    eligibleConnections: 0,
    providerFilteredConnections: 0,
  });

  const intervalRef = useRef(null);
  const tickCountRef = useRef(0);
  const quotaControllersRef = useRef(new Map());
  const quotaVersionsRef = useRef(new Map());
  const refreshAllPromiseRef = useRef(null);
  const mountedRef = useRef(true);

  const fetchConnections = useCallback(
    async (targetPage = page) => {
      try {
        const params = new URLSearchParams({
          page: String(targetPage),
          pageSize: String(pageSize),
          accountStatus: accountFilter,
          sort: "priority",
        });

        if (providerFilter !== "all") {
          params.set("provider", providerFilter);
        }

        const response = await fetch(
          `/api/providers/client?${params.toString()}`,
        );
        if (!response.ok) throw new Error("Failed to fetch connections");

        const data = await response.json();
        const connectionList = data.connections || [];
        const nextPagination = getSafePagination(data.pagination, pageSize);
        const nextTotals = getSafeTotals(data.totals, connectionList.length);

        setConnections(connectionList);
        setProviderOptions(getProviderOptions(data.providerOptions));
        setPagination(nextPagination);
        setTotals(nextTotals);
        setPage(getPaginationPageValue(data.pagination, targetPage));
        return connectionList;
      } catch (error) {
        console.error("Error fetching connections:", error);
        setConnections([]);
        setProviderOptions([]);
        setPagination({ page: 1, pageSize, total: 0, totalPages: 1 });
        setTotals({ eligibleConnections: 0, providerFilteredConnections: 0 });
        return [];
      }
    },
    [accountFilter, page, pageSize, providerFilter],
  );

  // Fetch quota for a specific connection. The optional commit=false mode is
  // used by refreshAll so a concurrency batch can commit React state together.

  const fetchQuota = useCallback(async (connectionId, provider, options = {}) => {
    const { commit = true, force = false } = options;
    const previousController = quotaControllersRef.current.get(connectionId);
    previousController?.abort();

    const version = (quotaVersionsRef.current.get(connectionId) || 0) + 1;
    quotaVersionsRef.current.set(connectionId, version);
    const controller = new AbortController();
    quotaControllersRef.current.set(connectionId, controller);

    if (commit) {
      setLoading((prev) => ({ ...prev, [connectionId]: true }));
      setErrors((prev) => ({ ...prev, [connectionId]: null }));
    }

    const isCurrent = () => (
      mountedRef.current && quotaVersionsRef.current.get(connectionId) === version
    );

    try {
      if (process.env.NEXT_PUBLIC_DEBUG_QUOTA === "true") {
        console.log(`[ProviderLimits] Fetching quota for ${provider} (${connectionId})`);
      }

      const response = await fetch(`/api/usage/${connectionId}${force ? "?force=1" : ""}`, {
        cache: "no-store",
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error || response.statusText;

        if (response.status === 404) {
          console.warn(`[ProviderLimits] Connection not found for ${provider}, skipping`);
          return { connectionId, skipped: true };
        }

        if (response.status === 401) {
          console.warn(`[ProviderLimits] Auth error for ${provider}:`, errorMsg);
          const quotaEntry = { quotas: [], message: errorMsg };
          if (isCurrent()) {
            setQuotaCache(connectionId, quotaEntry);
            if (commit) {
              setQuotaData((prev) => ({ ...prev, [connectionId]: quotaEntry }));
            }
          }
          return { connectionId, quotaEntry };
        }

        throw new Error(`HTTP ${response.status}: ${errorMsg}`);
      }

      const data = await response.json();
      if (process.env.NEXT_PUBLIC_DEBUG_QUOTA === "true") {
        console.log(`[ProviderLimits] Got quota for ${provider} (${connectionId})`, {
          status: response.status,
          quotaCount: Array.isArray(data?.quotas) ? data.quotas.length : undefined,
        });
      }

      const quotaEntry = {
        quotas: parseQuotaData(provider, data),
        plan: data.plan || null,
        message: data.message || null,
        raw: data,
      };

      if (!isCurrent()) return { connectionId, stale: true };
      setQuotaCache(connectionId, quotaEntry);
      if (commit) {
        setQuotaData((prev) => ({ ...prev, [connectionId]: quotaEntry }));
      }
      return { connectionId, quotaEntry };
    } catch (error) {
      if (error?.name === "AbortError" || !isCurrent()) {
        return { connectionId, aborted: true };
      }
      const message = error.message || "Failed to fetch quota";
      console.error(`[ProviderLimits] Error fetching quota for ${provider} (${connectionId}):`, message);
      if (commit) {
        setErrors((prev) => ({ ...prev, [connectionId]: message }));
      }
      return { connectionId, error: message };
    } finally {
      if (quotaControllersRef.current.get(connectionId) === controller) {
        quotaControllersRef.current.delete(connectionId);
      }
      if (commit && isCurrent()) {
        setLoading((prev) => ({ ...prev, [connectionId]: false }));
      }
    }
  }, []);

  // Refresh quota for a specific provider
  const refreshProvider = useCallback(
    async (connectionId, provider) => {
      await fetchQuota(connectionId, provider, { force: true });
      setLastUpdated(new Date());
    },
    [fetchQuota],
  );

  const handleResetCodexLimit = useCallback(
    async (connectionId, provider) => {
      if (provider !== "codex" || resettingLimitId) return;

      setResettingLimitId(connectionId);
      setErrors((prev) => ({ ...prev, [connectionId]: null }));

      try {
        const response = await fetch(`/api/usage/${connectionId}/codex-reset-credits`, { method: "POST" });
        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(result.message || result.error || result.code || "Failed to reset Codex limit");
        }

        await fetchQuota(connectionId, provider, { force: true });
        setLastUpdated(new Date());
      } catch (error) {
        setErrors((prev) => ({ ...prev, [connectionId]: error.message || "Failed to reset Codex limit" }));
      } finally {
        setResettingLimitId(null);
      }
    },
    [fetchQuota, resettingLimitId],
  );

  const handleViewCodexResetCredits = useCallback(async (connection) => {
    setResetCreditsState({ connection, loading: true, error: null, data: null });
    try {
      const response = await fetch(`/api/usage/${connection.id}/codex-reset-credits`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || result.message || "Failed to load Codex reset credits");
      }
      const credits = Array.isArray(result.credits) ? [...result.credits] : [];
      credits.sort((a, b) => {
        const aTime = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.POSITIVE_INFINITY;
        const bTime = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.POSITIVE_INFINITY;
        return aTime - bTime;
      });
      setResetCreditsState({ connection, loading: false, error: null, data: { ...result, credits } });
    } catch (error) {
      setResetCreditsState({ connection, loading: false, error: error.message || "Failed to load Codex reset credits", data: null });
    }
  }, []);

  const handleDeleteConnection = useCallback(
    async (id) => {
      if (!confirm("Delete this connection?")) return;
      setDeletingId(id);
      try {
        const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
        if (res.ok) {
          setQuotaData((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          setLoading((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          setErrors((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });

          if (typeof window !== "undefined") {
            try {
              removeQuotaCache(id);
            } catch (e) {
              console.error("Error deleting cache entry:", e);
            }
          }

          await reconcileConnectionsPage(fetchConnections, page);
        }
      } catch (error) {
        console.error("Error deleting connection:", error);
      } finally {
        setDeletingId(null);
      }
    },
    [fetchConnections, page],
  );

  const handleToggleConnectionActive = useCallback(
    async (id, isActive) => {
      setTogglingId(id);
      try {
        const res = await fetch(`/api/providers/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive }),
        });
        if (res.ok) {
          setQuotaData((prev) => {
            const next = { ...prev };
            return next;
          });
          await reconcileConnectionsPage(fetchConnections, page);
        }
      } catch (error) {
        console.error("Error updating connection status:", error);
      } finally {
        setTogglingId(null);
      }
    },
    [fetchConnections, page],
  );

  const handleUpdateConnection = useCallback(
    async (formData) => {
      if (!selectedConnection?.id) return;
      const connectionId = selectedConnection.id;
      const provider = selectedConnection.provider;
      try {
        const res = await fetch(`/api/providers/${connectionId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });
        if (res.ok) {
          await fetchConnections();
          setShowEditModal(false);
          setSelectedConnection(null);
          if (USAGE_SUPPORTED_PROVIDERS.includes(provider)) {
          await fetchQuota(connectionId, provider, { force: true });
          }
        }
      } catch (error) {
        console.error("Error saving connection:", error);
      }
    },
    [selectedConnection, fetchConnections, fetchQuota],
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/api/proxy-pools?isActive=true", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data?.proxyPools) {
          setProxyPools(data.proxyPools);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshAll = useCallback((force = false) => {
    if (refreshAllPromiseRef.current) return refreshAllPromiseRef.current;

    const operation = (async () => {
      setRefreshingAll(true);

      // Throttle Claude and skip entries whose SWR cache is still fresh.
      const tick = (tickCountRef.current += 1);
      const claudeEvery = Math.max(1, Math.round(CLAUDE_REFRESH_INTERVAL_MS / REFRESH_INTERVAL_MS));
      const cache = getQuotaCache();
      const now = Date.now();
      const isFresh = (connectionId) => {
        const cachedAt = Date.parse(cache[connectionId]?.cachedAt || "");
        return Number.isFinite(cachedAt) && now - cachedAt >= 0 && now - cachedAt < QUOTA_CACHE_TTL_MS;
      };
      const shouldFetch = (conn) => (
        force
        || (conn.provider === "claude" ? tick % claudeEvery === 0 : !isFresh(conn.id))
      );

      try {
        const visibleConnections = await fetchConnections(page);
        const candidates = visibleConnections.filter(shouldFetch);

        setLoading(buildLoadingState(candidates));
        setErrors((prev) => {
          const next = filterQuotaStateByConnections(prev, visibleConnections);
          for (const conn of candidates) next[conn.id] = null;
          return next;
        });
        setQuotaData((prev) =>
          filterQuotaStateByConnections(prev, visibleConnections),
        );

        const results = await runWithConcurrency(
          candidates,
          QUOTA_REFRESH_CONCURRENCY,
          (conn) => fetchQuota(conn.id, conn.provider, { commit: false, force }),
        );
        if (!mountedRef.current) return;

        setQuotaData((prev) => {
          const next = filterQuotaStateByConnections(prev, visibleConnections);
          for (const result of results) {
            if (result?.quotaEntry && !result.stale && !result.aborted) {
              next[result.connectionId] = result.quotaEntry;
            }
          }
          return next;
        });
        setErrors((prev) => {
          const next = filterQuotaStateByConnections(prev, visibleConnections);
          for (const result of results) {
            if (result?.error) next[result.connectionId] = result.error;
          }
          return next;
        });
        setLoading((prev) => {
          const next = filterQuotaStateByConnections(prev, visibleConnections);
          for (const conn of candidates) next[conn.id] = false;
          return next;
        });
        setLastUpdated(new Date());
      } catch (error) {
        console.error("Error refreshing all providers:", error);
      } finally {
        if (mountedRef.current) setRefreshingAll(false);
      }
    })();

    const trackedOperation = operation.finally(() => {
      if (refreshAllPromiseRef.current === trackedOperation) refreshAllPromiseRef.current = null;
    });
    refreshAllPromiseRef.current = trackedOperation;
    return trackedOperation;
  }, [fetchConnections, fetchQuota, page]);

  useEffect(() => {
    const initializeData = async () => {
      mountedRef.current = true;
      setConnectionsLoading(true);
      const visibleConnections = await fetchConnections(page);
      if (!mountedRef.current) return;
      setConnectionsLoading(false);

      const cache = getQuotaCache();
      const now = Date.now();
      const cachedEntries = Object.fromEntries(
        visibleConnections
          .map((conn) => [conn.id, cache[conn.id]])
          .filter(([, entry]) => {
            const cachedAt = Date.parse(entry?.cachedAt || "");
            return entry && Number.isFinite(cachedAt) && now - cachedAt >= 0 && now - cachedAt < QUOTA_CACHE_TTL_MS;
          }),
      );

      // Show recent cache immediately while the network refresh runs.
      setLoading(buildLoadingState(visibleConnections));
      setErrors((prev) =>
        filterQuotaStateByConnections(prev, visibleConnections),
      );
      setQuotaData((prev) => ({
        ...filterQuotaStateByConnections(prev, visibleConnections),
        ...cachedEntries,
      }));

      await runWithConcurrency(
        visibleConnections,
        QUOTA_REFRESH_CONCURRENCY,
        (conn) => fetchQuota(conn.id, conn.provider),
      );
      if (mountedRef.current) setLastUpdated(new Date());
    };

    void initializeData();
  }, [fetchConnections, fetchQuota, page]);

  useEffect(() => () => {
    mountedRef.current = false;
    for (const controller of quotaControllersRef.current.values()) controller.abort();
    quotaControllersRef.current.clear();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
    setAutoRefresh(stored === null ? true : stored === "true");
    setHasHydratedAutoRefresh(true);
  }, []);

  // Persist auto-refresh preference
  useEffect(() => {
    if (typeof window === "undefined" || !hasHydratedAutoRefresh) return;
    window.localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, String(autoRefresh));
  }, [autoRefresh, hasHydratedAutoRefresh]);

  // Load auto-ping per-connection maps
  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((s) => {
        setAutoPingMaps({
          claude: s?.claudeAutoPing?.connections || {},
          codex: s?.codexAutoPing?.connections || {},
        });
        setQuotaVisibility(s?.quotaVisibility || {});
      })
      .catch(() => {});
  }, []);

  const toggleAutoPing = useCallback(async (connectionId, provider, on) => {
    const settingsKey = AUTO_PING_SETTINGS_KEYS[provider];
    if (!settingsKey) return;

    const previous = autoPingMaps;
    const nextProviderMap = { ...(autoPingMaps[provider] || {}), [connectionId]: on };
    const nextMaps = { ...autoPingMaps, [provider]: nextProviderMap };
    setAutoPingMaps(nextMaps);
    try {
      const r = await fetch("/api/settings", { cache: "no-store" });
      const s = r.ok ? await r.json() : {};
      const cfg = { ...(s[settingsKey] || {}), connections: nextProviderMap };
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [settingsKey]: cfg }),
      });
    } catch {
      setAutoPingMaps(previous);
    }
  }, [autoPingMaps]);

  const updateQuotaVisibility = useCallback(async (nextVisibility, previousVisibility) => {
    setQuotaVisibility(nextVisibility);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quotaVisibility: nextVisibility }),
      });
      if (!response.ok) throw new Error("Failed to update quota visibility");
    } catch (error) {
      console.error("Error updating quota visibility:", error);
      setQuotaVisibility(previousVisibility);
    }
  }, []);

  const handleHideQuota = useCallback((provider, quota) => {
    const key = getQuotaVisibilityKey(quota);
    if (!provider || !key) return;

    const previous = quotaVisibility;
    const providerVisibility = previous[provider] || {};
    const hidden = new Set(providerVisibility.hidden || []);
    hidden.add(key);
    const next = {
      ...previous,
      [provider]: {
        ...providerVisibility,
        hidden: [...hidden],
      },
    };
    updateQuotaVisibility(next, previous);
  }, [quotaVisibility, updateQuotaVisibility]);

  const handleShowQuota = useCallback((provider, quota) => {
    const key = getQuotaVisibilityKey(quota);
    if (!provider || !key) return;

    const previous = quotaVisibility;
    const providerVisibility = previous[provider] || {};
    const hidden = new Set(providerVisibility.hidden || []);
    hidden.delete(key);
    const next = {
      ...previous,
      [provider]: {
        ...providerVisibility,
        hidden: [...hidden],
      },
    };
    updateQuotaVisibility(next, previous);
  }, [quotaVisibility, updateQuotaVisibility]);

  // Auto-refresh interval
  useEffect(() => {
    if (!hasHydratedAutoRefresh || !autoRefresh) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Main refresh interval
    intervalRef.current = setInterval(() => {
      refreshAll();
    }, REFRESH_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, refreshAll, hasHydratedAutoRefresh]);

  // Pause auto-refresh when tab is hidden (Page Visibility API)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } else if (autoRefresh && hasHydratedAutoRefresh) {
        // Resume auto-refresh when tab becomes visible
        intervalRef.current = setInterval(() => refreshAll(), REFRESH_INTERVAL_MS);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [autoRefresh, refreshAll, hasHydratedAutoRefresh]);

  const sortedConnections = useMemo(
    () =>
      sortVisibleConnections(
        connections,
        quotaData,
        expiringFirst,
        providerFilter,
        quotaSortMode,
      ),
    [connections, quotaData, expiringFirst, providerFilter, quotaSortMode],
  );

  // Connection is depleted when any quota entry hit the threshold
  const isConnectionDepleted = (conn) => {
    const quotas = quotaData[conn.id]?.quotas;
    if (!quotas?.length) return false;
    return quotas.some((q) => {
      if (!q.total || q.total <= 0) return false;
      return calculatePercentage(q.used, q.total) <= DEPLETED_QUOTA_THRESHOLD;
    });
  };

  const bulkSetActive = useCallback(
    async (targetIds, isActive) => {
      if (!targetIds.length || bulkToggling) return;
      setBulkToggling(true);
      try {
        await Promise.all(
          targetIds.map((id) =>
            fetch(`/api/providers/${id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ isActive }),
            }),
          ),
        );
        await reconcileConnectionsPage(fetchConnections, page);
      } catch (error) {
        console.error("Error bulk toggling connections:", error);
      } finally {
        setBulkToggling(false);
      }
    },
    [bulkToggling, fetchConnections, page],
  );

  const handleDisableDepleted = () => {
    const ids = sortedConnections
      .filter((c) => (c.isActive ?? true) && isConnectionDepleted(c))
      .map((c) => c.id);
    bulkSetActive(ids, false);
  };

  const handleEnableAvailable = () => {
    const ids = sortedConnections
      .filter((c) => !(c.isActive ?? true) && !isConnectionDepleted(c))
      .map((c) => c.id);
    bulkSetActive(ids, true);
  };

  const selectedProviderLabel =
    providerFilter === "all" ? "All providers" : providerFilter;
  const hasEligibleConnections = totals.eligibleConnections > 0;
  const hasVisibleConnections = sortedConnections.length > 0;
  const emptyState = getConnectionsEmptyMessage(
    totals,
    providerFilter,
    accountFilter,
  );
  const connectionsPageSummary = getConnectionsPaginationSummary(pagination);
  const isCustomPageSize = !ACCOUNT_PAGE_SIZE_OPTIONS.includes(pageSize);
  const pageSizeLabel = getPageSizeLabel(pageSize, isCustomPageSize);

  if (!connectionsLoading && !hasEligibleConnections) {
    return (
      <Card padding="lg">
        <div className="text-center py-12">
          <span className="material-symbols-outlined text-6xl text-text-muted opacity-20">
            cloud_off
          </span>
          <h3 className="mt-4 text-lg font-semibold text-text-primary">
            No Providers Connected
          </h3>
          <p className="mt-2 text-sm text-text-muted max-w-md mx-auto">
            Connect to providers with OAuth to track your API quota limits and
            usage.
          </p>
        </div>
      </Card>
    );
  }

  if (!connectionsLoading && !hasVisibleConnections) {
    return (
      <Card padding="lg">
        <div className="text-center py-12">
          <span className="material-symbols-outlined text-6xl text-text-muted opacity-20">
            {emptyState.icon}
          </span>
          <h3 className="mt-4 text-lg font-semibold text-text-primary">
            {emptyState.title}
          </h3>
          <p className="mt-2 text-sm text-text-muted max-w-md mx-auto">
            {emptyState.description}
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overview Section */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card padding="md" className="flex items-center gap-4 border border-black/10 dark:border-white/10 shadow-sm">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <span className="material-symbols-outlined text-2xl">group</span>
          </div>
          <div>
            <p className="text-sm font-medium text-text-muted">Total Accounts</p>
            <h4 className="text-2xl font-bold text-text-primary">{totals.eligibleConnections}</h4>
          </div>
        </Card>
        <Card padding="md" className="flex items-center gap-4 border border-black/10 dark:border-white/10 shadow-sm">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-500">
            <span className="material-symbols-outlined text-2xl">warning</span>
          </div>
          <div>
            <p className="text-sm font-medium text-text-muted">Critical Quotas</p>
            <h4 className="text-2xl font-bold text-text-primary">
              {sortedConnections.filter(c => isConnectionDepleted(c)).length}
            </h4>
          </div>
        </Card>
        <Card padding="md" className="flex items-center gap-4 border border-black/10 dark:border-white/10 shadow-sm">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
            <span className="material-symbols-outlined text-2xl">bolt</span>
          </div>
          <div>
            <p className="text-sm font-medium text-text-muted">Auto-Ping Active</p>
            <h4 className="text-2xl font-bold text-text-primary">
              {Object.values(autoPingMaps.claude || {}).filter(Boolean).length + Object.values(autoPingMaps.codex || {}).filter(Boolean).length}
            </h4>
          </div>
        </Card>
      </div>

      {/* Header Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Filters (Provider, Status, Sort) Placeholder if needed */}
          <select
            value={providerFilter}
            onChange={(e) => {
              setProviderFilter(e.target.value);
              setPage(1);
            }}
            className="h-8 rounded-lg border border-black/10 bg-white px-2 text-xs text-text-primary shadow-sm outline-none transition-colors hover:bg-black/5 dark:border-white/10 dark:bg-neutral-900 dark:hover:bg-white/10"
          >
            <option value="all">All Providers</option>
            {providerOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            value={accountFilter}
            onChange={(e) => {
              setAccountFilter(e.target.value);
              setPage(1);
            }}
            className="h-8 rounded-lg border border-black/10 bg-white px-2 text-xs text-text-primary shadow-sm outline-none transition-colors hover:bg-black/5 dark:border-white/10 dark:bg-neutral-900 dark:hover:bg-white/10"
          >
            {ACCOUNT_FILTER_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            value={quotaSortMode}
            onChange={(e) => setQuotaSortMode(e.target.value)}
            className="h-8 rounded-lg border border-black/10 bg-white px-2 text-xs text-text-primary shadow-sm outline-none transition-colors hover:bg-black/5 dark:border-white/10 dark:bg-neutral-900 dark:hover:bg-white/10"
          >
            {QUOTA_SORT_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Bulk Actions Dropdown */}
          <div className="relative group z-30">
            <button className="flex h-8 items-center justify-center gap-1 rounded-lg border border-black/10 bg-white px-2 text-xs font-medium text-text-primary shadow-sm transition-colors hover:bg-black/5 dark:border-white/10 dark:bg-neutral-900 dark:hover:bg-white/10">
              More options
              <span className="material-symbols-outlined text-sm">expand_more</span>
            </button>
            <div className="absolute left-0 mt-1 hidden w-48 flex-col rounded-lg border border-black/10 bg-white p-1 shadow-lg group-hover:flex dark:border-white/10 dark:bg-neutral-900">
              <button
                type="button"
                onClick={() => setExpiringFirst((prev) => !prev)}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${expiringFirst ? "bg-amber-500/10 text-amber-600" : "text-text-primary hover:bg-black/5 dark:hover:bg-white/5"}`}
              >
                <span className="material-symbols-outlined text-sm">hourglass_top</span>
                Expiring first
                {expiringFirst && <span className="material-symbols-outlined text-sm ml-auto">check</span>}
              </button>
              <div className="my-1 h-px bg-black/10 dark:bg-white/10"></div>
              <button
                type="button"
                onClick={handleDisableDepleted}
                disabled={bulkToggling}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-red-500 hover:bg-red-500/10 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-sm">block</span>
                Turn off Empty
              </button>
              <button
                type="button"
                onClick={handleEnableAvailable}
                disabled={bulkToggling}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-sm">check_circle</span>
                Turn on Available
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Auto-refresh toggle */}
          <button
            onClick={() => setAutoRefresh((prev) => !prev)}
            className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-black/10 px-2 text-xs transition-colors hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
            title={autoRefresh ? "Disable auto-refresh" : "Enable auto-refresh"}
          >
            <span
              className={`material-symbols-outlined text-sm ${
                autoRefresh ? "text-primary" : "text-text-muted"
              }`}
            >
              {autoRefresh ? "toggle_on" : "toggle_off"}
            </span>
            <span className="hidden text-text-primary sm:inline">
              Auto-refresh
            </span>
            <RefreshCountdown active={autoRefresh && hasHydratedAutoRefresh} />
          </button>


          {/* Refresh all button */}
          <button
            type="button"
            onClick={() => refreshAll(true)}
            disabled={refreshingAll}
            className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-black/10 px-2 text-xs text-text-primary transition-colors hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5 disabled:opacity-50"
            title="Refresh all"
          >
            <span
              className={`material-symbols-outlined text-sm ${refreshingAll ? "animate-spin" : ""}`}
            >
              refresh
            </span>
          </button>
        </div>
      </div>

      {/* Provider cards: 2 columns, compact */}
      {expiringFirst && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Expiring-first currently reorders accounts inside the current page.
          Cross-page ordering still follows backend pagination.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sortedConnections.map((conn) => {
          const quota = quotaData[conn.id];
          const isLoading = loading[conn.id];
          const error = errors[conn.id];

          // Use table layout for all providers
          const isInactive = conn.isActive === false;
          const isCodex = conn.provider === "codex";
          const resetCreditCount = getCodexResetCreditCount(quota);
          const isResettingLimit = resettingLimitId === conn.id;
          const rowBusy = deletingId === conn.id || togglingId === conn.id || isResettingLimit;
          const rawQuotas = quota?.quotas || [];
          const visibleQuotas = filterQuotasByVisibility(conn.provider, rawQuotas, quotaVisibility);
          const hiddenQuotaRows = getHiddenQuotaRows(conn.provider, rawQuotas, quotaVisibility);

          return (
            <Card
              key={conn.id}
              padding="none"
              className={`min-w-0 ${isInactive ? "opacity-60" : ""}`}
            >
              <div className="px-3 py-2 border-b border-black/10 dark:border-white/10">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 shrink-0 rounded-md flex items-center justify-center overflow-hidden">
                      <ProviderIcon
                        src={`/providers/${conn.provider}.png`}
                        alt={conn.provider}
                        size={32}
                        className="object-contain"
                        fallbackText={
                          conn.provider?.slice(0, 2).toUpperCase() || "PR"
                        }
                      />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-text-primary capitalize truncate">
                        {conn.provider}
                      </h3>
                      {getConnectionLabel(conn) ? (
                        <p className="text-xs text-text-muted truncate">
                          {getConnectionLabel(conn)}
                        </p>
                      ) : null}
                      {getConnectionSecondaryLabel(conn) ? (
                        <p className="text-xs text-text-muted/80 truncate">
                          {getConnectionSecondaryLabel(conn)}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Tooltip text="Refresh quota">
                      <button
                        type="button"
                        onClick={() => refreshProvider(conn.id, conn.provider)}
                        disabled={isLoading || rowBusy}
                        aria-label="Refresh quota"
                        className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
                      >
                        <span
                          className={`material-symbols-outlined text-lg text-text-muted ${isLoading ? "animate-spin" : ""}`}
                        >
                          refresh
                        </span>
                      </button>
                    </Tooltip>
                    <div
                      className="inline-flex items-center"
                      title={
                        (conn.isActive ?? true)
                          ? "Disable connection"
                          : "Enable connection"
                      }
                    >
                      <Toggle
                        size="sm"
                        checked={conn.isActive ?? true}
                        disabled={rowBusy}
                        onChange={(nextActive) =>
                          handleToggleConnectionActive(conn.id, nextActive)
                        }
                      />
                    </div>
                    
                    {/* Secondary Actions (Kebab Menu) */}
                    <div className="relative group/kebab ml-1">
                      <button className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                        <span className="material-symbols-outlined text-lg">more_vert</span>
                      </button>
                      <div className="absolute right-0 top-full mt-1 hidden w-48 flex-col rounded-lg border border-black/10 bg-white p-1 shadow-lg group-hover/kebab:flex dark:border-white/10 dark:bg-neutral-900 z-10">
                        {isCodex && (
                          <>
                            <button
                              type="button"
                              onClick={() => setResetConfirmState({ connection: conn, resetCreditCount })}
                              disabled={resetCreditCount <= 0 || isLoading || rowBusy}
                              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${resetCreditCount > 0 ? "text-text-primary hover:bg-black/5 dark:hover:bg-white/5" : "text-text-muted opacity-50"}`}
                            >
                              <span className={`material-symbols-outlined text-sm ${isResettingLimit ? "animate-spin" : ""}`}>
                                {isResettingLimit ? "progress_activity" : "restart_alt"}
                              </span>
                              Use Reset Credit ({resetCreditCount})
                            </button>
                            <button
                              type="button"
                              onClick={() => handleViewCodexResetCredits(conn)}
                              disabled={isLoading || rowBusy}
                              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-text-primary hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
                            >
                              <span className="material-symbols-outlined text-sm">schedule</span>
                              Check Expiry
                            </button>
                          </>
                        )}
                        {AUTO_PING_SETTINGS_KEYS[conn.provider] && conn.authType === "oauth" && (
                          <button
                            type="button"
                            onClick={() => toggleAutoPing(conn.id, conn.provider, !(autoPingMaps[conn.provider]?.[conn.id] === true))}
                            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/5 ${autoPingMaps[conn.provider]?.[conn.id] === true ? "text-primary" : "text-text-primary"}`}
                          >
                            <span className="material-symbols-outlined text-sm">bolt</span>
                            Auto-ping
                          </button>
                        )}
                        <div className="my-1 h-px bg-black/10 dark:bg-white/10"></div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedConnection(conn);
                            setShowEditModal(true);
                          }}
                          disabled={rowBusy}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-text-primary hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
                        >
                          <span className="material-symbols-outlined text-sm">edit</span>
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteConnection(conn.id)}
                          disabled={rowBusy}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-red-500 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          <span className={`material-symbols-outlined text-sm ${deletingId === conn.id ? "animate-pulse" : ""}`}>
                            delete
                          </span>
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-2 py-1.5">
                {isLoading && !quota ? (
                  <div className="space-y-3 p-3">
                    <div className="flex animate-pulse items-center gap-3">
                      <div className="h-2.5 w-1/4 rounded-full bg-black/10 dark:bg-white/10"></div>
                      <div className="h-2.5 w-1/4 rounded-full bg-black/10 dark:bg-white/10 ml-auto"></div>
                    </div>
                    <div className="h-3 w-full rounded-full bg-black/10 dark:bg-white/10 animate-pulse"></div>
                    <div className="flex animate-pulse items-center gap-3">
                      <div className="h-2 w-1/5 rounded-full bg-black/5 dark:bg-white/5"></div>
                      <div className="h-2 w-1/5 rounded-full bg-black/5 dark:bg-white/5 ml-auto"></div>
                    </div>
                  </div>
                ) : error && !quota ? (
                  <div className="text-center py-5">
                    <span className="material-symbols-outlined text-3xl text-red-500">
                      error
                    </span>
                    <p className="mt-1.5 text-xs text-text-muted">{error}</p>
                  </div>
                ) : (visibleQuotas.length === 0 && quota?.message) ? (
                  <div className="text-center py-5">
                    <p className="text-xs text-text-muted">{quota.message}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {quota?.message && visibleQuotas.length > 0 && (
                      <p className="px-1 text-xs text-text-muted">{quota.message}</p>
                    )}
                    <QuotaTable
                      quotas={visibleQuotas}
                      compact
                      sortMode="default"
                      showSortLabel={
                        conn.provider === "codex" && quotaSortMode !== "default"
                      }
                      onHideQuota={(quotaRow) => handleHideQuota(conn.provider, quotaRow)}
                    />
                  </div>
                )}
                {hiddenQuotaRows.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-black/5 pt-2 text-xs text-text-muted dark:border-white/5">
                    <span className="material-symbols-outlined text-sm">
                      visibility_off
                    </span>
                    <span>Hidden:</span>
                    {hiddenQuotaRows.map((quotaRow) => (
                      <button
                        key={getQuotaVisibilityKey(quotaRow)}
                        type="button"
                        onClick={() => handleShowQuota(conn.provider, quotaRow)}
                        className="rounded-md border border-black/10 px-1.5 py-0.5 transition-colors hover:bg-black/5 hover:text-text-primary dark:border-white/10 dark:hover:bg-white/5"
                        title="Show this quota row"
                      >
                        {quotaRow.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <div className="rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-text-muted">{connectionsPageSummary}</span>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={isCustomPageSize ? "custom" : String(pageSize)}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  if (nextValue === "custom") return;
                  const nextPageSize = Number.parseInt(nextValue, 10);
                  if (Number.isFinite(nextPageSize)) {
                    setPage(1);
                    setPageSize(nextPageSize);
                    setCustomPageSizeInput(String(nextPageSize));
                  }
                }}
                className="h-8 rounded-lg border border-black/10 bg-black/[0.02] px-2 text-xs text-text-primary outline-none transition-colors hover:bg-black/5 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/10"
                aria-label="Accounts per page"
              >
                {ACCOUNT_PAGE_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={String(option)}>
                    {option} / page
                  </option>
                ))}
                <option value="custom">Custom</option>
              </select>
              <input
                type="number"
                min="1"
                max={String(ACCOUNT_PAGE_SIZE_MAX)}
                inputMode="numeric"
                value={customPageSizeInput}
                onChange={(event) => setCustomPageSizeInput(event.target.value)}
                onBlur={() => {
                  const parsedValue = Number.parseInt(customPageSizeInput, 10);
                  if (!Number.isFinite(parsedValue)) {
                    setCustomPageSizeInput(String(pageSize));
                    return;
                  }
                  const nextPageSize = Math.min(ACCOUNT_PAGE_SIZE_MAX, Math.max(1, parsedValue));
                  setPage(1);
                  setPageSize(nextPageSize);
                  setCustomPageSizeInput(String(nextPageSize));
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  const parsedValue = Number.parseInt(customPageSizeInput, 10);
                  if (!Number.isFinite(parsedValue)) {
                    setCustomPageSizeInput(String(pageSize));
                    return;
                  }
                  const nextPageSize = Math.min(ACCOUNT_PAGE_SIZE_MAX, Math.max(1, parsedValue));
                  setPage(1);
                  setPageSize(nextPageSize);
                  setCustomPageSizeInput(String(nextPageSize));
                }}
                className="h-8 w-20 rounded-lg border border-black/10 bg-black/[0.02] px-2 text-xs text-text-primary outline-none transition-colors hover:bg-black/5 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/10"
                aria-label="Custom accounts per page"
                placeholder="Custom"
              />
              <span className="text-xs text-text-muted">Page {pagination.page} / {pagination.totalPages}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPage(1)}
                disabled={
                  pagination.page <= 1 || connectionsLoading || refreshingAll
                }
                className="flex h-8 items-center rounded-lg border border-black/10 px-3 text-xs text-text-primary transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
              >
                First Page
              </button>
              <button
                type="button"
                onClick={() =>
                  setPage((currentPage) => Math.max(1, currentPage - 1))
                }
                disabled={
                  pagination.page <= 1 || connectionsLoading || refreshingAll
                }
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/10 text-text-primary transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
                aria-label="Previous accounts page"
              >
                <span className="material-symbols-outlined text-base">
                  chevron_left
                </span>
              </button>
              <button
                type="button"
                onClick={() =>
                  setPage((currentPage) =>
                    Math.min(pagination.totalPages, currentPage + 1),
                  )
                }
                disabled={
                  pagination.page >= pagination.totalPages ||
                  connectionsLoading ||
                  refreshingAll
                }
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/10 text-text-primary transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
                aria-label="Next accounts page"
              >
                <span className="material-symbols-outlined text-base">
                  chevron_right
                </span>
              </button>
              <button
                type="button"
                onClick={() => setPage(pagination.totalPages)}
                disabled={
                  pagination.page >= pagination.totalPages ||
                  connectionsLoading ||
                  refreshingAll
                }
                className="flex h-8 items-center rounded-lg border border-black/10 px-3 text-xs text-text-primary transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
              >
                Last Page
              </button>
            </div>
          </div>
        </div>

      <ConfirmModal
        isOpen={Boolean(resetConfirmState)}
        onClose={() => {
          if (!resettingLimitId) setResetConfirmState(null);
        }}
        onConfirm={async () => {
          const connection = resetConfirmState?.connection;
          if (!connection) return;
          await handleResetCodexLimit(connection.id, connection.provider);
          setResetConfirmState(null);
        }}
        title="Reset Codex limit?"
        message={`Use 1 Codex reset credit for ${getConnectionLabel(resetConfirmState?.connection || {}) || "this account"}. This cannot be undone. Remaining credits: ${resetConfirmState?.resetCreditCount ?? 0}.`}
        confirmText="Reset limit"
        cancelText="Cancel"
        variant="danger"
        loading={Boolean(resettingLimitId)}
      />

      {resetCreditsState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-black/15 bg-white shadow-2xl ring-1 ring-black/10 dark:border-white/15 dark:bg-neutral-950 dark:ring-white/10">
            <div className="flex items-start justify-between gap-3 border-b border-black/10 bg-black/[0.03] px-4 py-3 dark:border-white/10 dark:bg-white/[0.04]">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-text-primary">Codex Reset Credit Expiry</h3>
                <p className="mt-0.5 truncate text-xs text-text-muted">
                  {getConnectionLabel(resetCreditsState.connection) || "Codex account"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setResetCreditsState(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/5"
                aria-label="Close reset credit expiry modal"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="max-h-[70vh] overflow-auto bg-white p-4 dark:bg-neutral-950">
              {resetCreditsState.loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted">
                  <span className="material-symbols-outlined animate-spin text-xl">progress_activity</span>
                  Loading reset credits...
                </div>
              ) : resetCreditsState.error ? (
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
                  {resetCreditsState.error}
                </div>
              ) : resetCreditsState.data?.credits?.length ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2 text-xs text-text-muted dark:border-white/10 dark:bg-white/[0.03]">
                    <span>{resetCreditsState.data.credits.length} reset credit{resetCreditsState.data.credits.length === 1 ? "" : "s"}</span>
                    <span>{resetCreditsState.data.availableCount ?? 0} available</span>
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
                    <table className="w-full min-w-[560px] text-left text-sm">
                      <thead className="bg-black/[0.03] text-xs uppercase tracking-wide text-text-muted dark:bg-white/[0.04]">
                        <tr>
                          <th className="px-3 py-2 font-medium">Status</th>
                          <th className="px-3 py-2 font-medium">Granted At</th>
                          <th className="px-3 py-2 font-medium">Expires At</th>
                          <th className="px-3 py-2 font-medium">Remaining</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resetCreditsState.data.credits.map((credit, index) => (
                          <tr key={`${credit.status}-${credit.expiresAt || index}`} className="border-t border-black/5 dark:border-white/5">
                            <td className="px-3 py-2">
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                                {credit.status || "unknown"}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-text-muted">{formatCreditDate(credit.grantedAt)}</td>
                            <td className="px-3 py-2 text-text-primary">{formatCreditDate(credit.expiresAt)}</td>
                            <td className="px-3 py-2 font-medium text-text-primary">{formatTimeRemaining(credit.expiresAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-black/10 bg-black/[0.02] px-3 py-8 text-center text-sm text-text-muted dark:border-white/10 dark:bg-white/[0.03]">
                  No reset credit details returned for this account.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <EditConnectionModal
        isOpen={showEditModal}
        connection={selectedConnection}
        proxyPools={proxyPools}
        onSave={handleUpdateConnection}
        onClose={() => {
          setShowEditModal(false);
          setSelectedConnection(null);
        }}
      />
    </div>
  );
}
