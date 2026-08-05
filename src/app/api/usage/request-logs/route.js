import { NextResponse } from "next/server";
import { getRecentLogsPage } from "@/lib/usageDb";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const hasCursor = url.searchParams.has("afterId");
    const afterId = hasCursor ? url.searchParams.get("afterId") : null;
    const page = await getRecentLogsPage(200, { afterId });
    const etag = `W/\"usage-${page.latestId}\"`;
    const headers = {
      "Cache-Control": "no-store",
      ETag: etag,
      "X-Usage-Last-Id": String(page.latestId),
      "X-Usage-Cursor-Id": String(page.cursorId ?? page.latestId),
    };

    if (request.headers.get("if-none-match") === etag && !page.reset && (!hasCursor || page.logs.length === 0)) {
      return new Response(null, { status: 304, headers });
    }

    if (!hasCursor) return NextResponse.json(page.logs, { headers });
    return NextResponse.json({
      logs: page.logs,
      latestId: page.latestId,
      cursorId: page.cursorId,
      reset: page.reset,
    }, { headers });
  } catch (error) {
    console.error("[API ERROR] /api/usage/logs failed:", error);
    console.error("[API ERROR] Stack:", error?.stack);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}
