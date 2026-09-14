// Budget & spend-anomaly alerts for virtual keys.
//
// Evaluates on usage-save events (debounced by the stats emitter) and pushes
// edge-triggered alerts: a virtual-key budget crossing 50/80/100% (each level
// fires once per month until it drops back under 25%) and provider spend
// spikes (last hour > 4× the previous 24h hourly average, re-armable every 6h).
//
// Surfaces: "alerts" event on statsEmitter (forwarded on /api/usage/stream as
// {type:"alerts"} for the dashboard banner) + optional Windows toast.

import { execFile } from "node:child_process";
import { getSettings, getApiKeys, getKeySpendMapUsd } from "@/lib/db/index.js";
import { getProviderSpendWindows, statsEmitter } from "@/lib/usageDb";

const MIN_EVAL_INTERVAL_MS = 30 * 1000;
const ANOMALY_REASSERT_MS = 6 * 3600 * 1000;
const ANOMALY_MIN_USD = 0.5;      // ignore rounding noise on quiet providers
const ANOMALY_MULTIPLIER = 4;     // last hour vs previous-24h hourly average
const RECENT_MAX = 10;
const BUDGET_LEVELS = [50, 80, 100];

if (!global._usageAlertsState) {
  global._usageAlertsState = {
    attached: false,
    evaluating: false,
    lastEvalAt: 0,
    budgetLevels: new Map(),   // keyId -> last notified level (0 = none)
    anomalyLastAt: new Map(),  // provider -> ts of last anomaly alert
    recent: [],                // most-recent-first fired alerts
  };
}
const alertsState = global._usageAlertsState;

export function getActiveUsageAlerts() {
  // Banner shows alerts from the last 24h only.
  const cutoff = Date.now() - 24 * 3600 * 1000;
  return alertsState.recent.filter((a) => new Date(a.ts).getTime() > cutoff);
}

function fireAlert(alert) {
  alertsState.recent.unshift(alert);
  if (alertsState.recent.length > RECENT_MAX) alertsState.recent.length = RECENT_MAX;
  statsEmitter.emit("alerts", [alert]);
}

// Best-effort Windows toast via WinRT (no extra modules). Requires
// settings.usageAlertsToastEnabled — checked by the caller.
function fireWindowsToast(title, message) {
  if (process.platform !== "win32") return;
  const safe = (s) => String(s || "").replace(/[`"$/\\]/g, "").slice(0, 160);
  const script = [
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
    "$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
    '$texts = $template.GetElementsByTagName("text")',
    `$texts.Item(0).AppendChild($template.CreateTextNode("${safe(title)}")) | Out-Null`,
    `$texts.Item(1).AppendChild($template.CreateTextNode("${safe(message)}")) | Out-Null`,
    "$toast = [Windows.UI.Notifications.ToastNotification]::new($template)",
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($toast)`,
  ].join("\n");
  try {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], () => { /* best effort */ });
  } catch { /* best effort */ }
}

async function notify(settings, alert) {
  fireAlert(alert);
  if (settings?.usageAlertsToastEnabled) {
    fireWindowsToast("Switch Router", alert.message);
  }
}

async function evaluateBudgetAlerts(settings) {
  const keys = await getApiKeys();
  const spendMap = await getKeySpendMapUsd();
  const now = Date.now();

  for (const key of keys) {
    if (key.isActive === false || key.monthlyBudgetUsd == null) continue;
    const budget = Number(key.monthlyBudgetUsd);
    if (!Number.isFinite(budget) || budget <= 0) continue;

    const spend = Number(spendMap[key.id]) || 0;
    const ratio = spend / budget;
    const level = ratio >= 1 ? 100 : ratio >= 0.8 ? 80 : ratio >= 0.5 ? 50 : 0;
    const lastLevel = alertsState.budgetLevels.get(key.id) || 0;

    if (level > lastLevel) {
      const pct = Math.min(999, Math.round(ratio * 100));
      await notify(settings, {
        ts: new Date().toISOString(),
        type: "budget",
        level,
        keyId: key.id,
        keyName: key.name || key.id?.slice(0, 8),
        message: level >= 100
          ? `Ngân sách tháng của khóa "${key.name}" đã VƯỢT (${spend.toFixed(2)}/${budget.toFixed(2)} USD)`
          : `Khóa "${key.name}" đã dùng ${pct}% ngân sách tháng (${spend.toFixed(2)}/${budget.toFixed(2)} USD)`,
      });
    }
    // New month / fresh budget → arm all levels again once usage drops low.
    alertsState.budgetLevels.set(key.id, ratio < 0.25 ? 0 : Math.max(level, lastLevel));
  }
}

async function evaluateSpikeAlerts(settings) {
  const { last1h, prev24h } = await getProviderSpendWindows();
  const now = Date.now();

  for (const [provider, spent1h] of Object.entries(last1h)) {
    if (spent1h < ANOMALY_MIN_USD) continue;
    const hourlyAvg = (Number(prev24h[provider]) || 0) / 24;
    if (hourlyAvg > 0 && spent1h < hourlyAvg * ANOMALY_MULTIPLIER) continue;
    // Quiet history also counts as anomalous when the spend is meaningful.
    if (hourlyAvg === 0 && spent1h < 2) continue;

    const lastAt = alertsState.anomalyLastAt.get(provider) || 0;
    if (now - lastAt < ANOMALY_REASSERT_MS) continue;

    alertsState.anomalyLastAt.set(provider, now);
    await notify(settings, {
      ts: new Date().toISOString(),
      type: "spend-spike",
      level: 80,
      provider,
      message: `Chi phí "${provider}" 1 giờ qua bất thường: ${spent1h.toFixed(2)} USD (trung bình ${hourlyAvg.toFixed(2)} USD/giờ trong 24h trước)`,
    });
  }
}

export async function evaluateUsageAlerts() {
  const st = alertsState;
  if (st.evaluating) return;
  if (Date.now() - st.lastEvalAt < MIN_EVAL_INTERVAL_MS) return;
  st.evaluating = true;
  try {
    const settings = await getSettings();
    st.lastEvalAt = Date.now();
    await evaluateBudgetAlerts(settings);
    await evaluateSpikeAlerts(settings);
  } catch (err) {
    console.error("[usageAlerts] evaluate failed:", err?.message || err);
  } finally {
    st.evaluating = false;
  }
}

// Subscribe once per process: every persisted usage row (debounced) re-checks
// thresholds. Imported by the usage stream route, so this attaches as soon as
// any dashboard is open — and stays attached for the process lifetime.
export function ensureUsageAlertsAttached() {
  const st = alertsState;
  if (st.attached) return;
  st.attached = true;
  statsEmitter.on("update", () => {
    evaluateUsageAlerts().catch(() => {});
  });
}
