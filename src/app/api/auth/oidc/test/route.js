import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    error: "OIDC dashboard authentication is disabled in local-only mode.",
    dashboardAuthDisabled: true,
    localOnly: true,
  }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
