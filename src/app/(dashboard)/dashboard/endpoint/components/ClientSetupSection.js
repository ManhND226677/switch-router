"use client";

// "Connect clients" section on the Virtual Keys page: everything a client
// needs to point at the gateway — base URLs and the Claude for M365
// namespace. The QuickStart snippet card was removed (redundant with Base
// URLs); consolidated here when /dashboard became an overview-only page.
import { useState } from "react";
import { Card, Toggle } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import BaseUrlsCard from "./BaseUrlsCard";

export default function ClientSetupSection({ origin, keys, requireApiKey, onRequireApiKeyChange, officeAllowlistCount }) {
  const { copied, copy } = useCopyToClipboard();
  const [officeEnabled] = useState(true);

  return (
    <div className="flex flex-col gap-6">
      {/* Require API key — moved from the old endpoint page */}
      <Card id="require-api-key" title="Require API key" icon="key">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-text-main">Require API key</p>
            <p className="text-sm text-text-muted">Requests without a valid key will be rejected.</p>
          </div>
          <Toggle checked={requireApiKey} onChange={(value) => onRequireApiKeyChange(value)} />
        </div>
      </Card>

      {/* All endpoint families — OpenAI, Anthropic and the M365 namespace — in ONE card */}
      <BaseUrlsCard origin={origin} officeEnabled={officeEnabled} />
    </div>
  );
}
