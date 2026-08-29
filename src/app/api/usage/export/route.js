import { NextResponse } from "next/server";
import { isLocalRequest } from "@/dashboardGuard";
import { getUsageHistory } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";

export const dynamic = "force-dynamic";

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

let cachedCliToken = null;
// Phải SO SÁNH GIÁ TRỊ token với máy (như dashboardGuard.hasValidCliToken),
// không được chỉ kiểm tra header tồn tại — header client tự gửi được.
async function hasValidCliToken(request) {
  const token = request.headers.get(CLI_TOKEN_HEADER);
  if (!token) return false;
  if (!cachedCliToken) cachedCliToken = await getConsistentMachineId(CLI_TOKEN_SALT);
  return token === cachedCliToken;
}

async function canUse(request) {
  return isLocalRequest(request) || (await hasValidCliToken(request));
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  // Quote when the field contains a delimiter, quote, or newline.
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// GET /api/usage/export — download the usage history as CSV (Excel-friendly,
// UTF-8 BOM so Vietnamese text opens correctly). Supports the same filters as
// /api/usage/history: provider, model, startDate, endDate. API keys are
// exported masked (apiKeyMasked) — raw keys never leave the DB.
export async function GET(request) {
  if (!canUse(request)) {
    return NextResponse.json(
      { error: "Switch-Router usage export is local-only" },
      { status: 403 }
    );
  }

  try {
    const { searchParams } = request.nextUrl;
    const filter = {};
    for (const key of ["provider", "model", "startDate", "endDate"]) {
      const value = searchParams.get(key);
      if (value) filter[key] = value;
    }

    const rows = await getUsageHistory(filter);

    const header = [
      "timestamp",
      "provider",
      "model",
      "endpoint",
      "status",
      "prompt_tokens",
      "completion_tokens",
      "total_tokens",
      "cost_usd",
      "api_key_masked",
      "connection_id",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      const tokens = r.tokens || {};
      const prompt = tokens.prompt_tokens ?? tokens.input_tokens ?? "";
      const completion = tokens.completion_tokens ?? tokens.output_tokens ?? "";
      const total =
        prompt !== "" && completion !== "" ? Number(prompt) + Number(completion) : "";
      lines.push(
        [
          csvEscape(r.timestamp),
          csvEscape(r.provider),
          csvEscape(r.model),
          csvEscape(r.endpoint),
          csvEscape(r.status),
          prompt,
          completion,
          total,
          r.cost ?? "",
          csvEscape(r.apiKeyMasked),
          csvEscape(r.connectionId),
        ].join(",")
      );
    }

    // UTF-8 BOM so Excel renders diacritics correctly.
    const body = "\uFEFF" + lines.join("\r\n");
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="switch-router-usage-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Error exporting usage CSV:", error);
    return NextResponse.json({ error: "Failed to export usage" }, { status: 500 });
  }
}
