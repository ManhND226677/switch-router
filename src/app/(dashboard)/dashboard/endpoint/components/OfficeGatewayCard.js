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
    </div>
  );
}
