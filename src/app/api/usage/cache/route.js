import { NextResponse } from "next/server";
import { getCacheStats } from "@/lib/usageDb";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "90d"]);

export const dynamic = "force-dynamic";

// GET /api/usage/cache?period=7d — cache-hit telemetry: hit-rate per provider
// and top models (which provider caches your repeated context best).
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";
    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }
    return NextResponse.json(await getCacheStats(period));
  } catch (error) {
    console.error("[API] Failed to compute cache stats:", error);
    return NextResponse.json({ error: "Failed to fetch cache stats" }, { status: 500 });
  }
}
