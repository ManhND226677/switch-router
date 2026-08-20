import { NextResponse } from "next/server";
import { canAccessLocalDashboard } from "@/dashboardGuard";

// Compatibility stub — dashboard never requires login in local-only mode.
export async function GET(request) {
  return NextResponse.json({
    requireLogin: false,
    dashboardAuthDisabled: true,
    localOnly: true,
    canAccessDashboard: canAccessLocalDashboard(request),
  }, { headers: { "Cache-Control": "no-store" } });
}
