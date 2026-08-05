// Skip during Next.js build/prerender — bootstrap starts optional local services.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build"
  || process.env.NEXT_PHASE === "phase-export"
  || process.env.NEXT_PHASE === "phase-static";

// Optional local maintenance (quota auto-ping) is deliberately opt-in for the
// personal Switch-Router runtime. Importing the dashboard must not start
// background work just because the app was opened.
const optionalMaintenanceEnabled = (
  process.env.SWITCH_ROUTER_ENABLE_OPTIONAL_INFRASTRUCTURE
  || process.env.NINEROUTER_ENABLE_OPTIONAL_INFRASTRUCTURE
) === "true";

// Server-only singleton: guard via global so HMR / re-imports don't double-init
if (
  typeof window === "undefined"
  && !isBuildPhase
  && optionalMaintenanceEnabled
  && !global.__appBootstrapped
) {
  global.__appBootstrapped = true;
  import("./initializeApp.js")
    .then(({ default: initializeApp }) => initializeApp())
    .catch((e) => console.error("[Bootstrap] optional infrastructure init failed:", e.message));
}
