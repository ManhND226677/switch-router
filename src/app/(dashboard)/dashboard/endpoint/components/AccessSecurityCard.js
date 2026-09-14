"use client";

import { Badge } from "@/shared/components";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * Explains who can actually reach this gateway, and flags the one genuinely
 * risky combination: bound to a non-loopback address while API keys are not
 * required — that is an unauthenticated LLM proxy on the network.
 */
export default function AccessSecurityCard({ origin, requireApiKey }) {
  let hostname = "";
  try {
    hostname = new URL(origin).hostname;
  } catch {
    hostname = "";
  }

  const isLoopback = LOOPBACK_HOSTS.has(hostname);
  const isExposed = !isLoopback && !requireApiKey;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={isExposed ? "error" : isLoopback ? "success" : "warning"} dot size="sm">
          {isLoopback ? "loopback only" : isExposed ? "exposed without auth" : "non-loopback bind"}
        </Badge>
        <span className="font-mono text-sm text-text-muted">{hostname || origin}</span>
      </div>

      {isExposed && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
          <p className="text-sm font-medium text-red-600 dark:text-red-400">
            This gateway accepts requests from outside this machine and does not require an API key.
          </p>
          <p className="mt-1 text-sm leading-6 text-red-600/90 dark:text-red-400/90">
            Anyone who can reach <code className="font-mono text-xs">{hostname}</code> can spend your provider quota.
            Turn on <code className="font-mono text-xs">Require API key</code> below, or bind back to{" "}
            <code className="font-mono text-xs">127.0.0.1</code>.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border-subtle bg-surface-2 p-3">
          <p className="text-xs uppercase tracking-wide text-text-muted">Local clients</p>
          <p className="mt-1 text-sm leading-6 text-text-main">
            {isLoopback
              ? "Only processes on this machine can connect. Other devices on your LAN cannot."
              : "The server is bound to a non-loopback address, so other machines can connect."}
          </p>
        </div>
        <div className="rounded-lg border border-border-subtle bg-surface-2 p-3">
          <p className="text-xs uppercase tracking-wide text-text-muted">Remote access</p>
          <p className="mt-1 text-sm leading-6 text-text-main">
            No tunnel or public relay is built in. To reach the gateway from elsewhere, put an HTTPS
            reverse proxy in front of it and require an API key.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border-subtle bg-surface-2 p-4">
        <p className="text-sm font-medium text-text-main">Credentials stay on this machine</p>
        <p className="mt-1 text-sm leading-6 text-text-muted">
          Provider API keys and OAuth tokens are stored in the local SQLite database and are never
          sent anywhere except to the upstream provider that owns them. Requests are forwarded with
          the real client IP derived from the TCP socket, so client-supplied forwarding headers
          cannot spoof rate-limit identity.
        </p>
      </div>
    </div>
  );
}
