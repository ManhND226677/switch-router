import { NextResponse } from "next/server";
import { exportDb, getSettings, importDb } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { isLocalRequest, hasValidCliToken } from "@/dashboardGuard";

// Phải SO SÁNH GIÁ TRỊ token với máy (như dashboardGuard.hasValidCliToken),
// không được chỉ kiểm tra header tồn tại — header client tự gửi được.
async function canUseDatabaseRoute(request) {
  return isLocalRequest(request) || (await hasValidCliToken(request));
}

export async function GET(request) {
  try {
    if (!(await canUseDatabaseRoute(request))) {
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
    if (!(await canUseDatabaseRoute(request))) {
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
