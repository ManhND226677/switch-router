import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    error: "Dashboard authentication is disabled. Access the dashboard from the local machine.",
    dashboardAuthDisabled: true,
    localOnly: true,
  }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
