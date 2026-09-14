import { NextResponse } from "next/server";
import { getErrorAnalytics } from "@/lib/usageDb";
import { toValidDateIso } from "@/lib/db/repos/dateFilter";

export const dynamic = "force-dynamic";

const ALLOWED_GROUPS = new Set(["provider:model", "provider", "model"]);

/**
 * GET /api/usage/errors
 * Aggregated failures from requestDetails: grouped counts, per-day burst, top
 * error signatures and a recent list. Aggregation lives in requestDetailsRepo.
 *
 * Query: startDate, endDate, groupBy (provider:model|provider|model),
 *        recentLimit (1..100, default 20).
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const groupBy = searchParams.get("groupBy") || "provider:model";
    const recentLimit = parseInt(searchParams.get("recentLimit"), 10) || 20;

    if (!ALLOWED_GROUPS.has(groupBy)) {
      return NextResponse.json({ error: "groupBy must be provider:model, provider or model" }, { status: 400 });
    }
    if ((startDate && !toValidDateIso(startDate)) || (endDate && !toValidDateIso(endDate))) {
      return NextResponse.json({ error: "startDate/endDate must be valid date strings" }, { status: 400 });
    }

    const analytics = await getErrorAnalytics({ startDate, endDate, groupBy, recentLimit });
    return NextResponse.json({ generatedAt: new Date().toISOString(), ...analytics });
  } catch (error) {
    console.error("[API] Failed to aggregate errors:", error);
    return NextResponse.json({ error: "Failed to fetch error analytics" }, { status: 500 });
  }
}
