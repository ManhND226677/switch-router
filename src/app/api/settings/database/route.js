import { NextResponse } from "next/server";
import { exportDb, getSettings, importDb } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { isLocalRequest } from "@/dashboardGuard";

const CLI_TOKEN_HEADER = "x-9r-cli-token";

// CLI token requests are already trusted (local machine); skip password re-auth.
function isCliRequest(request) {
  return Boolean(request.headers.get(CLI_TOKEN_HEADER));
}

function canUseDatabaseRoute(request) {
  return isLocalRequest(request) || isCliRequest(request);
}

export async function GET(request) {
  try {
    if (!canUseDatabaseRoute(request)) {
      return NextResponse.json({ error: "Switch-Router database access is local-only" }, { status: 403 });
    }
    const payload = await exportDb();
    return NextResponse.json(payload);
  } catch (error) {
    console.error("Error exporting database:", error);
    return NextResponse.json({ error: "Failed to export database" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const payload = await request.json();
    if (!canUseDatabaseRoute(request)) {
      return NextResponse.json({ error: "Switch-Router database access is local-only" }, { status: 403 });
    }
    await importDb(payload);

    // Ensure proxy settings take effect immediately after a DB import.
    try {
      const settings = await getSettings();
      applyOutboundProxyEnv(settings);
    } catch (err) {
      console.warn("[Settings][DatabaseImport] Failed to re-apply outbound proxy env:", err);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error importing database:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to import database" },
      { status: 400 }
    );
  }
}
