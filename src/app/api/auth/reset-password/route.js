import { NextResponse } from "next/server";

// Compatibility stub — dashboard password auth was removed (local-only mode).
export async function POST() {
  return NextResponse.json({
    error: "Dashboard password authentication is disabled in local-only mode.",
    dashboardAuthDisabled: true,
    localOnly: true,
  }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
