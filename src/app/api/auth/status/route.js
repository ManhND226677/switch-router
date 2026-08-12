import { NextResponse } from "next/server";
import { canAccessLocalDashboard } from "@/dashboardGuard";

export async function GET(request) {
  return NextResponse.json({
    requireLogin: false,
    authMode: "local-only",
    dashboardAuthDisabled: true,
    localOnly: true,
    canAccessDashboard: canAccessLocalDashboard(request),
  }, { headers: { "Cache-Control": "no-store" } });
}
