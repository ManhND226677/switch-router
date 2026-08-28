// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  saveRequestUsage, flushPendingUsage, getUsageHistory, getUsageHistoryPage, getUsageStats, getChartData,
  invalidateUsageStatsCache, getUsageStatsVersion, appendRequestLog, getLatestUsageId,
  getRecentLogs, getRecentLogsPage, getProviderSpendWindows, getCacheStats,
  saveRequestDetail, getRequestDetails, getRequestDetailById, getErrorAnalytics,
} from "./db/index.js";
