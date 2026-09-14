import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { getHealthProberStatus } from "@/sse/services/healthProber";

export const dynamic = "force-dynamic";

// GET /api/health/probe — background health-prober status + per-connection
// probe history (last 20 pings each). The prober itself is started with the
// chat module; this only reports.
export async function GET() {
  try {
    const settings = await getSettings();
    const status = getHealthProberStatus();
    return NextResponse.json({
      enabled: settings.healthProberEnabled === true,
      ...status,
    });
  } catch (error) {
    console.error("[API] Failed to get health prober status:", error);
    return NextResponse.json({ error: "Failed to fetch prober status" }, { status: 500 });
  }
}
