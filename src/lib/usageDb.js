// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  saveRequestUsage, getUsageHistory, getUsageHistoryPage, getUsageStats, getChartData,
  invalidateUsageStatsCache, appendRequestLog, getLatestUsageId,
  getRecentLogs, getRecentLogsPage,
  saveRequestDetail, getRequestDetails, getRequestDetailById,
} from "@/lib/db/index.js";
