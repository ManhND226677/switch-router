import { NextResponse } from "next/server";
import { getApiKeys, createApiKey, getKeySpendMapUsd } from "@/lib/localDb";
import { sanitizeApiKey, normalizeKeyPolicyInput } from "@/lib/db/repos/apiKeysRepo";
import { getConsistentMachineId } from "@/shared/utils/machineId";

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys (kèm chi tiêu tháng theo từng khóa)
export async function GET() {
  try {
    const [keys, spendMap] = await Promise.all([
      getApiKeys(),
      getKeySpendMapUsd().catch(() => ({})),
    ]);
    return NextResponse.json({
      keys: keys.map((k) => sanitizeApiKey({ ...k, spentUsd: spendMap[k.id] ?? 0 })),
    });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  try {
    const body = await request.json();
    const { name } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    const normalized = normalizeKeyPolicyInput(body);
    if (normalized.error) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId, normalized.value);

    // machineId is embedded in the key itself (sk-{machineId}-…) and is a
    // machine fingerprint — never echo it back to the client.
    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      allowedModels: apiKey.allowedModels,
      monthlyBudgetUsd: apiKey.monthlyBudgetUsd,
      rateLimitRpm: apiKey.rateLimitRpm,
      expiresAt: apiKey.expiresAt,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
