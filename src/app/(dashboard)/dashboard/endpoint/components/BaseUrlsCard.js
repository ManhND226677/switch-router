"use client";

// Base URLs card — the single "point your client here" surface. Every public
// endpoint family lives here as one row: OpenAI-compatible, Anthropic Messages
// and the Claude for M365 namespace (gated by the Office Gateway setting).
import { Badge, Card } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import EndpointRow from "./EndpointRow";
import { ENDPOINT_GROUPS } from "../endpointConstants";

export default function BaseUrlsCard({ origin, officeEnabled = true }) {
  const { copied, copy } = useCopyToClipboard();

  return (
    <Card title="Base URLs" icon="api" subtitle="One gateway, several client formats. Point each tool at the base URL matching the API it speaks.">
      <div className="grid grid-cols-1 gap-x-10 gap-y-5 2xl:grid-cols-2">
        {ENDPOINT_GROUPS.map((group) => {
          if (group.requiresOfficeGateway) {
            return (
              <div key={group.id} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={officeEnabled ? "info" : "default"} dot size="sm">
                    {officeEnabled ? "Enabled" : "Disabled"}
                  </Badge>
                  <span className="text-xs text-text-muted">
                    {officeEnabled
                      ? "Isolated namespace for Office agents — always requires its own API key."
                      : "Enable the Office Gateway in Settings → Optional Features to use this namespace."
                  </span>
                </div>
                {officeEnabled && (
                  <EndpointRow
                    label={group.label}
                    badge={group.badge}
                    tone={group.tone}
                    url={`${origin}${group.path}`}
                    copyId={`endpoint_${group.id}`}
                    copied={copied}
                    onCopy={copy}
                    desc={group.desc}
                    routes={group.routes}
                  />
                )}
              </div>
            );
          }
          return (
            <EndpointRow
              key={group.id}
              label={group.label}
              badge={group.badge}
              tone={group.tone}
              url={`${origin}${group.path}`}
              copyId={`endpoint_${group.id}`}
              copied={copied}
              onCopy={copy}
              desc={group.desc}
              routes={group.routes}
            />
          );
        })}
      </div>
    </Card>
  );
}
