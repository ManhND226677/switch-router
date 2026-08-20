// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  saveRequestUsage, getUsageHistory, getUsageHistoryPage, getUsageStats, getChartData,
  invalidateUsageStatsCache, getUsageStatsVersion, appendRequestLog, getLatestUsageId,
  getRecentLogs, getRecentLogsPage,
  saveRequestDetail, getRequestDetails, getRequestDetailById,
} from "./db/index.js";
