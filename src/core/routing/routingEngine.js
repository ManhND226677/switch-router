/**
 * Small account fallback orchestration core.
 *
 * The engine deliberately knows nothing about the database, provider adapters,
 * HTTP status codes, or response formats. Callers inject credential resolution,
 * one-attempt execution, and failure classification. This keeps the switching
 * policy reusable when model/provider candidates are added later.
 */
export class RoutingEngine {
  constructor({ resolveCredentials, executeAttempt, onFailure, maxAttempts = 64 } = {}) {
    if (typeof resolveCredentials !== "function") {
      throw new TypeError("RoutingEngine requires resolveCredentials");
    }
    if (typeof executeAttempt !== "function") {
      throw new TypeError("RoutingEngine requires executeAttempt");
    }
    if (typeof onFailure !== "function") {
      throw new TypeError("RoutingEngine requires onFailure");
    }

    this.resolveCredentials = resolveCredentials;
    this.executeAttempt = executeAttempt;
    this.onFailure = onFailure;
    this.maxAttempts = Math.max(1, maxAttempts);
  }

  /**
   * Execute one provider/model request and move to the next credential only when
   * the injected failure policy explicitly allows fallback.
   *
   * @returns {Promise<object>} The successful/terminal attempt result, or an
   * unavailable outcome when no credential remains.
   */
  async execute({ provider, model, context } = {}) {
    const excludedConnectionIds = new Set();
    let lastResult = null;
    let attempts = 0;

    while (attempts < this.maxAttempts) {
      const credentials = await this.resolveCredentials({
        provider,
        model,
        context,
        attempts,
        excludedConnectionIds,
      });

      if (!credentials || credentials.allRateLimited) {
        return {
          outcome: "unavailable",
          credentials,
          lastResult,
          attempts,
          excludedConnectionIds,
        };
      }

      attempts += 1;
      const result = await this.executeAttempt({
        provider,
        model,
        context,
        credentials,
        attempts,
        excludedConnectionIds,
      });

      if (result?.success) return result;

      lastResult = result;
      const decision = await this.onFailure({
        provider,
        model,
        context,
        credentials,
        result,
        attempts,
        excludedConnectionIds,
      });

      if (!decision?.shouldFallback) return result;

      const connectionId = credentials.connectionId || credentials.id;
      // A virtual/no-auth connection cannot produce a meaningful next candidate.
      if (!connectionId || connectionId === "noauth" || excludedConnectionIds.has(connectionId)) {
        return result;
      }

      excludedConnectionIds.add(connectionId);
    }

    return {
      outcome: "unavailable",
      credentials: null,
      lastResult,
      attempts,
      excludedConnectionIds,
    };
  }
}

export default RoutingEngine;
