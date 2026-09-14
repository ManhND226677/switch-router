import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { resetComboRotation } from "open-sse/services/combo.js";
import { normalizeRoutingSettingsPatch } from "@/core/routing/routingConfig.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SETTINGS_RESPONSE_HEADERS = {
  "Cache-Control": "no-store"
};

// Secrets must never be mass-assigned from request body (CWE-915).
// officeModelAllowlistCount is env-derived (OFFICE_MODEL_IDS) and read-only:
// strip it so a PATCH can never persist a stale copy. officeGatewayEnabled is
// DB-backed since the Optional-features toggle was added — it IS settable.
const PROTECTED_SETTING_KEYS = [
  "password",
  "newPassword",
  "currentPassword",
  "requireLogin",
  "authMode",
  "oidcIssuerUrl",
  "oidcClientId",
  "oidcClientSecret",
  "oidcScopes",
  "oidcLoginLabel",
  "officeModelAllowlistCount",
];

function sanitizeSettings(settings = {}) {
  const safeSettings = { ...settings };
  for (const key of [
    "password",
    "oidcIssuerUrl",
    "oidcClientId",
    "oidcClientSecret",
    "oidcScopes",
    "oidcLoginLabel",
    "requireLogin",
    "authMode",
  ]) {
    delete safeSettings[key];
  }
  safeSettings.dashboardAuthDisabled = true;
  safeSettings.localOnly = true;
  return safeSettings;
}

export async function GET() {
  try {
    const settings = await getSettings();
    const safeSettings = sanitizeSettings(settings);
    
    const enableRequestLogs = process.env.ENABLE_REQUEST_LOGS === "true";
    // Office gateway is now a DB-backed setting (Optional features toggle in
    // Settings). The model allowlist count stays env-derived from OFFICE_MODEL_IDS.
    const officeGatewayEnabled = settings.officeGatewayEnabled === true;
    const officeModelAllowlistCount = String(process.env.OFFICE_MODEL_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .length;

    return NextResponse.json({
      ...safeSettings,
      enableRequestLogs,
      officeGatewayEnabled,
      officeModelAllowlistCount,
      dashboardAuthDisabled: true,
      localOnly: true,
    }, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.error("Error getting settings:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = normalizeRoutingSettingsPatch(await request.json());

    // Strip protected secrets before any internal handling sets them
    for (const key of PROTECTED_SETTING_KEYS) delete body[key];

    const settings = await updateSettings(body);

    // Apply outbound proxy settings immediately (no restart required)
    if (
      Object.prototype.hasOwnProperty.call(body, "outboundProxyEnabled") ||
      Object.prototype.hasOwnProperty.call(body, "outboundProxyUrl") ||
      Object.prototype.hasOwnProperty.call(body, "outboundNoProxy")
    ) {
      applyOutboundProxyEnv(settings);
    }

    // Invalidate combo rotation state when strategy settings change
    if (
      Object.prototype.hasOwnProperty.call(body, "comboStrategy") ||
      Object.prototype.hasOwnProperty.call(body, "comboStickyRoundRobinLimit") ||
      Object.prototype.hasOwnProperty.call(body, "comboStrategies")
    ) {
      resetComboRotation();
    }

    if (
      Object.prototype.hasOwnProperty.call(body, "claudeAutoPing") ||
      Object.prototype.hasOwnProperty.call(body, "codexAutoPing")
    ) {
      // Keep the scheduler absent when no account opted in; load its provider graph only on demand.
      import("@/shared/services/quotaAutoPing")
        .then(({ configureQuotaAutoPing }) => {
          configureQuotaAutoPing(settings);
        })
        .catch((error) => console.warn("[AutoPing] settings update failed:", error.message));
    }

    const safeSettings = sanitizeSettings(settings);
    return NextResponse.json(safeSettings, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.error("Error updating settings:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
