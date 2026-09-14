// Pure WorkBuddy catalog policy shared by server resolvers and the browser UI.
// The registry retains legacy ids for backward-compatible routing, while this
// allowlist controls what the product advertises when no live account catalog
// is available.

export const WORKBUDDY_FALLBACK_SUPPORTED_MODEL_IDS = new Set([
  "default-model",
  "hy4-preview",
  "hy3",
  "glm-5.3",
  "glm-5.3-flash",
  "glm-5.2",
  "glm-5.1",
  "glm-5v-turbo",
  "minimax-m3",
  "minimax-m2.7",
  "kimi-k3",
  "kimi-k2.7-code",
  "kimi-k2.6",
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "deepseek-v4.1-flash",
]);

const FREE_WORKBUDDY_BILLING_MODES = new Set(["free", "free_trial", "promo", "trial"]);

export function isWorkbuddyFreeModel(model) {
  if (!model || typeof model !== "object") return false;
  if (model.isFree === true || model.free === true || model.promo === true || model.isPromo === true) return true;
  const billingMode = String(model.billingMode || model.billing_mode || "").trim().toLowerCase();
  return FREE_WORKBUDDY_BILLING_MODES.has(billingMode);
}

export function isWorkbuddyModelVisible(model) {
  if (!model?.id) return false;
  // A free/promo model remains visible even when an older upstream response
  // did not attach an availability bit.
  if (isWorkbuddyFreeModel(model)) return true;
  if (model.available === false) return false;
  if (model.catalogSource === "static") {
    return WORKBUDDY_FALLBACK_SUPPORTED_MODEL_IDS.has(model.id);
  }
  // A successfully parsed live model is account-supported unless upstream
  // explicitly marked it unavailable.
  return true;
}

export function filterWorkbuddyModels(models) {
  const seen = new Set();
  return (Array.isArray(models) ? models : []).filter((model) => {
    if (!isWorkbuddyModelVisible(model) || seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

