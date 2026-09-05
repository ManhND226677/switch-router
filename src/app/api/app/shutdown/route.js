import { NextResponse } from "next/server";
import { killAppProcesses } from "@/lib/appShutdown";

// Stop the local server without involving any package updater.
export async function POST() {
  // Drain write-behind queues (sticky-RR counters, usage rows, latency EWMA)
  // before exit.
  try {
    const [{ flushRrCounters }, { flushPendingUsage }, { flushConnectionLatency }] = await Promise.all([
      import("@/sse/services/auth.js"),
      import("@/lib/usageDb.js"),
      import("open-sse/services/connectionLatency.js"),
    ]);
    await Promise.allSettled([flushRrCounters(), flushPendingUsage(), flushConnectionLatency()]);
  } catch { /* best effort — all three are acceleration/telemetry data only */ }

  try {
    const { stopHealthProber } = await import("@/sse/services/healthProber.js");
    stopHealthProber();
  } catch { /* best effort */ }

  try {
    const { stopQuotaAutoPing } = await import("@/shared/services/quotaAutoPing.js");
    stopQuotaAutoPing();
  } catch { /* best effort */ }

  try {
    await killAppProcesses();
  } catch {
    // Best effort: the process still exits below.
  }

  const response = NextResponse.json({ success: true, message: "Shutting down..." });
  setTimeout(() => process.exit(0), 500);
  return response;
}
