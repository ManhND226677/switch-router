import { NextResponse } from "next/server";
import { killAppProcesses } from "@/lib/appShutdown";

// Stop the local server without involving any package updater.
export async function POST() {
  try {
    await killAppProcesses();
  } catch {
    // Best effort: the process still exits below.
  }

  const response = NextResponse.json({ success: true, message: "Shutting down..." });
  setTimeout(() => process.exit(0), 500);
  return response;
}
