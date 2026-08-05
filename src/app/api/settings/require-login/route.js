import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { canAccessLocalDashboard } from "@/dashboardGuard";

export async function GET(request) {
  try {
    const settings = await getSettings();
    const requireLogin = settings.requireLogin !== false && !canAccessLocalDashboard(request);
    return NextResponse.json({ requireLogin });
  } catch (error) {
    return NextResponse.json({ requireLogin: !canAccessLocalDashboard(request) }, { status: 200 });
  }
}
