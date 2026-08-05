"use client";

import { Badge } from "@/shared/components";

/**
 * Compact runtime facts for the gateway: liveness, bind address, key policy,
 * model catalog size. Every value comes from an API the dashboard already
 * calls — this card adds no new backend route.
 */
export default function RuntimeStatusCard({
  health,
  origin,
  requireApiKey,
  modelCount,
  activeKeyCount,
  officeGatewayEnabled,
}) {
  const healthVariant = health === "ok" ? "success" : health === "checking" ? "default" : "error";
  const healthLabel = health === "ok" ? "running" : health === "checking" ? "checking..." : "unreachable";

  const items = [
    {
      id: "bind",
      icon: "lan",
      label: "Listening on",
      value: origin.replace(/^https?:\/\//, ""),
    },
    {
      id: "auth",
      icon: "key",
      label: "Require API key",
      value: requireApiKey ? "on" : "off",
      variant: requireApiKey ? "success" : "warning",
    },
    {
      id: "keys",
      icon: "vpn_key",
      label: "Active keys",
      value: activeKeyCount === null ? "—" : String(activeKeyCount),
    },
    {
      id: "models",
      icon: "neurology",
      label: "Models available",
      value: modelCount === null ? "—" : String(modelCount),
    },
    {
      id: "office",
      icon: "description",
      label: "Office gateway",
      value: officeGatewayEnabled ? "Enabled" : "Disabled",
      variant: officeGatewayEnabled ? "info" : "default",
    },
  ];

  return (
    <div className="flex flex-wrap items-stretch gap-3">
      <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-2 px-3 py-2">
        <Badge variant={healthVariant} dot size="sm">{healthLabel}</Badge>
      </div>

      {items.map((item) => (
        <div
          key={item.id}
          className="flex min-w-[150px] flex-1 items-center gap-2.5 rounded-lg border border-border-subtle bg-surface-2 px-3 py-2"
        >
          <span className="material-symbols-outlined text-[18px] text-text-muted">{item.icon}</span>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-text-muted">{item.label}</p>
            <p className={`truncate font-mono text-sm ${
              item.variant === "warning"
                ? "text-yellow-600 dark:text-yellow-400"
                : item.variant === "success"
                  ? "text-green-600 dark:text-green-400"
                  : item.variant === "info"
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-text-main"
            }`}>
              {item.value}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
