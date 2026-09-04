"use client";

import { useEffect } from "react";

/**
 * Suppresses noisy client-side console output in production browser builds.
 *
 * Why a gate instead of editing 245 call sites:
 *  - The 245 `console.log` calls are scattered across client and server code.
 *  - In the browser, `console.log` only writes to devtools; it is pure noise in
 *    a production build.
 *  - Server-side log capture (`src/lib/consoleLogBuffer`) patches `console.*` on
 *    the Node process. This effect runs ONLY in the browser (useEffect never
 *    executes during SSR), so the server ring buffer is completely unaffected.
 *
 * Behaviour:
 *  - Development builds: console is untouched (full logging).
 *  - Production builds: `log` / `debug` / `info` become silent.
 *  - `error` / `warn` are preserved so genuine failures still surface.
 *  - Set `window.__SR_KEEP_LOGS = true` at runtime to re-enable client logs
 *    (useful when debugging a production build).
 */
export default function ClientConsoleGate() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;

    const suppressed = ["log", "debug", "info"];
    for (const level of suppressed) {
      const original = console[level];
      if (typeof original !== "function") continue;
      try {
        console[level] = (...args) => {
          if (typeof window !== "undefined" && window.__SR_KEEP_LOGS) {
            original.apply(console, args);
          }
        };
      } catch {
        /* console[level] is non-writable in this environment — leave as-is */
      }
    }
  }, []);

  return null;
}
