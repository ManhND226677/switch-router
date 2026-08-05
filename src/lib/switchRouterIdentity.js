export const SWITCH_ROUTER_PROVIDER = "switch-router";
export const LEGACY_SWITCH_ROUTER_PROVIDER = "9router";

export const SWITCH_ROUTER_MODEL_PREFIX = `${SWITCH_ROUTER_PROVIDER}/`;
export const LEGACY_SWITCH_ROUTER_MODEL_PREFIX = `${LEGACY_SWITCH_ROUTER_PROVIDER}/`;

export const SWITCH_ROUTER_DROID_PREFIX = "custom:Switch-Router";
export const LEGACY_SWITCH_ROUTER_DROID_PREFIX = "custom:9Router";

export function getSwitchRouterProvider(container) {
  if (!container || typeof container !== "object") return null;
  return container[SWITCH_ROUTER_PROVIDER] || container[LEGACY_SWITCH_ROUTER_PROVIDER] || null;
}

export function isSwitchRouterModelId(value) {
  return typeof value === "string"
    && (value.startsWith(SWITCH_ROUTER_MODEL_PREFIX) || value.startsWith(LEGACY_SWITCH_ROUTER_MODEL_PREFIX));
}

export function stripSwitchRouterModelPrefix(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(SWITCH_ROUTER_MODEL_PREFIX, "")
    .replace(LEGACY_SWITCH_ROUTER_MODEL_PREFIX, "");
}

export function isSwitchRouterDroidId(value) {
  return typeof value === "string"
    && (value.startsWith(SWITCH_ROUTER_DROID_PREFIX) || value.startsWith(LEGACY_SWITCH_ROUTER_DROID_PREFIX));
}
