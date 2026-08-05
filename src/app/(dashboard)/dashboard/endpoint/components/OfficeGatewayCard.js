"use client";

import { Badge } from "@/shared/components";
import EndpointRow from "./EndpointRow";

/**
 * Describes the isolated Claude for M365 gateway.
 *
 * Read-only on purpose: OFFICE_GATEWAY_ENABLED is an environment flag consumed
 * at request time, so a toggle here would imply a live switch that does not
 * exist. The card explains the current state and what else is required.
 */
export default function OfficeGatewayCard({ origin, enabled, allowlistCount, copied, onCopy }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={enabled ? "info" : "default"} dot size="sm">
          {enabled ? "Enabled" : "Disabled"}
        </Badge>
        <span className="text-sm text-text-muted">
          {enabled
            ? "The /office/v1 namespace is serving requests."
            : "Set OFFICE_GATEWAY_ENABLED=true and restart to serve this namespace."}
        </span>
      </div>

      {enabled && (
        <div className="flex flex-col gap-3">
          <EndpointRow
            label="Models"
            badge="M365"
            tone="office"
            url={`${origin}/office/v1/models`}
            copyId="office_models"
            copied={copied}
            onCopy={onCopy}
          />
          <EndpointRow
            label="Messages"
            badge="M365"
            tone="office"
            url={`${origin}/office/v1/messages`}
            copyId="office_messages"
            copied={copied}
            onCopy={onCopy}
          />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border-subtle bg-surface-2 p-3">
          <p className="text-xs uppercase tracking-wide text-text-muted">Authentication</p>
          <p className="mt-1 text-sm leading-6 text-text-main">
            Always requires a Switch-Router API key, even when <code className="font-mono text-xs">Require API key</code> is off.
            Send it as <code className="font-mono text-xs">x-api-key</code>.
          </p>
        </div>
        <div className="rounded-lg border border-border-subtle bg-surface-2 p-3">
          <p className="text-xs uppercase tracking-wide text-text-muted">Allowed origin</p>
          <p className="mt-1 font-mono text-sm text-text-main">https://pivot.claude.ai</p>
          <p className="mt-1 text-xs text-text-muted">
            {allowlistCount > 0
              ? `Model catalog restricted to ${allowlistCount} explicit ID(s) via OFFICE_MODEL_IDS.`
              : "No OFFICE_MODEL_IDS allowlist — Claude-named models from the catalog are exposed."}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border-subtle bg-surface-2 p-4">
        <p className="text-sm font-medium text-text-main">Reachable from Microsoft 365?</p>
        <p className="mt-1 text-sm leading-6 text-text-muted">
          Claude for M365 calls the gateway from the internet, so a loopback URL is not enough.
          Terminate HTTPS on a reverse proxy and map <code className="font-mono text-xs">/v1/models</code> and{" "}
          <code className="font-mono text-xs">/v1/messages</code> onto the <code className="font-mono text-xs">/office/v1</code> paths above,
          with response buffering disabled so streaming works. Setup steps live in{" "}
          <code className="font-mono text-xs">docs/CLAUDE-OFFICE.vi.md</code>.
        </p>
      </div>
    </div>
  );
}
