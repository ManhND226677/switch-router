import { cleanupProviderConnections, getSettings } from "@/lib/localDb";
import { killAllBridges } from "@/lib/mcp/stdioSseBridge";

process.setMaxListeners(20);

// Defer optional maintenance work so the first local dashboard request stays fast.
const STARTUP_DEFER_MS = 3000;

const g = global.__appSingleton ??= {
  signalHandlersRegistered: false,
};

export async function initializeApp() {
  try {
    if (!g.signalHandlersRegistered) {
      const cleanup = () => {
        try { killAllBridges(); } catch { /* best effort */ }
        process.exit();
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);
      g.signalHandlersRegistered = true;
    }

    setTimeout(() => {
      runHeavyStartup().catch((error) => {
        console.error("[InitApp] deferred startup failed:", error.message);
      });
    }, STARTUP_DEFER_MS);
  } catch (error) {
    console.error("[InitApp] Error:", error);
  }
}

async function runHeavyStartup() {
  await cleanupProviderConnections();
  const settings = await getSettings();

  // Compact bloated requestDetails off the request path. Historical rows that
  // escaped truncation can be multi-MB each; leaving them around freezes
  // /api/usage/stats and stalls the whole process.
  try {
    const { compactRequestDetails } = await import("@/lib/db/repos/requestDetailsRepo.js");
    const result = await compactRequestDetails();
    if (result && !result.skipped) {
      const beforeMb = ((result.before?.bytes || 0) / (1024 * 1024)).toFixed(1);
      const afterMb = ((result.after?.bytes || 0) / (1024 * 1024)).toFixed(1);
      console.log(
        `[InitApp] compacted requestDetails: ${result.before?.c || 0}->${result.after?.c || 0} rows, ` +
        `${beforeMb}->${afterMb} MB (dropped bloated=${result.deletedBloated || 0})`,
      );
    }
  } catch (error) {
    console.warn("[InitApp] requestDetails compact skipped:", error.message);
  }

  if (hasQuotaAutoPingEnabled(settings)) {
    import("@/shared/services/quotaAutoPing")
      .then(({ startQuotaAutoPing }) => startQuotaAutoPing())
      .catch((error) => console.log("[AutoPing] scheduler start failed:", error.message));
  }
}

function hasQuotaAutoPingEnabled(settings) {
  return [settings?.claudeAutoPing, settings?.codexAutoPing]
    .some((config) => Object.values(config?.connections || {}).some(Boolean));
}

export default initializeApp;
