"use client";

// "Connect clients" section on the Virtual Keys page: everything a client
// needs to point at the gateway — base URLs and the Claude for M365
// namespace. The QuickStart snippet card was removed (redundant with Base
// URLs); consolidated here when /dashboard became an overview-only page.
// The Require-API-key toggle was hidden (setting stays enforced server-side
// via /api/settings; manage through the API if ever needed).
import { useState } from "react";
import BaseUrlsCard from "./BaseUrlsCard";

export default function ClientSetupSection({ origin, keys, officeAllowlistCount }) {
  const [officeEnabled] = useState(true);

  return (
    <div className="flex flex-col gap-6">
      {/* All endpoint families — OpenAI, Anthropic and the M365 namespace — in ONE card */}
      <BaseUrlsCard origin={origin} officeEnabled={officeEnabled} />
    </div>
  );
}
