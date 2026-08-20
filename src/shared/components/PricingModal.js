"use client";

import { useState, useEffect } from "react";
import { getDefaultPricing } from "open-sse/providers/pricing.js";
import Modal from "./Modal";
import Button from "./Button";
import { useNotificationStore } from "@/store/notificationStore";

const PRICING_FIELDS = ["input", "output", "cached", "reasoning", "cache_creation"];
const FIELD_LABELS = {
  input: "Input",
  output: "Output",
  cached: "Cached",
  reasoning: "Reasoning",
  cache_creation: "Cache Creation",
};

export default function PricingModal({ isOpen, onClose, onSave }) {
  const [pricingData, setPricingData] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const notifySuccess = useNotificationStore((s) => s.success);
  const notifyWarning = useNotificationStore((s) => s.warning);
  const notifyErr = useNotificationStore((s) => s.error);

  const loadPricing = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/pricing");
      if (response.ok) {
        const data = await response.json();
        setPricingData(data || {});
      } else {
        setPricingData(getDefaultPricing());
      }
    } catch (error) {
      console.error("Failed to load pricing:", error);
      setPricingData(getDefaultPricing());
    } finally {
      setLoading(false);
    }
  };

  /* eslint-disable react-hooks/set-state-in-effect -- load pricing when the modal opens. */
  useEffect(() => {
    if (isOpen) loadPricing();
  }, [isOpen]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handlePricingChange = (provider, model, field, value) => {
    if (value === "") {
      setPricingData((prev) => {
        const next = { ...prev };
        if (!next[provider]) next[provider] = {};
        if (!next[provider][model]) next[provider][model] = {};
        next[provider][model] = { ...next[provider][model], [field]: 0 };
        return next;
      });
      return;
    }

    const numValue = parseFloat(value);
    if (Number.isNaN(numValue) || numValue < 0) return;

    setPricingData((prev) => {
      const next = { ...prev };
      if (!next[provider]) next[provider] = {};
      if (!next[provider][model]) next[provider][model] = {};
      next[provider][model] = { ...next[provider][model], [field]: numValue };
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pricingData),
      });

      if (response.ok) {
        notifySuccess("Pricing saved");
        onSave?.();
        onClose();
      } else {
        const error = await response.json().catch(() => ({}));
        notifyErr(error.error || "Failed to save pricing");
      }
    } catch (error) {
      console.error("Failed to save pricing:", error);
      notifyErr("Failed to save pricing");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm("Reset all pricing to defaults? This cannot be undone.")) return;

    try {
      const response = await fetch("/api/pricing", { method: "DELETE" });
      if (response.ok) {
        setPricingData(getDefaultPricing());
        notifyWarning("Pricing reset to defaults — click Save to persist");
      } else {
        notifyErr("Failed to reset pricing");
      }
    } catch (error) {
      console.error("Failed to reset pricing:", error);
      notifyErr("Failed to reset pricing");
    }
  };

  const allProviders = Object.keys(pricingData || {}).sort();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Pricing Configuration"
      size="full"
      className="!max-w-6xl"
      closeOnOverlay={!saving}
      footer={(
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={saving || loading}
            className="text-red-500 hover:bg-red-500/10 sm:self-start"
          >
            Reset to Defaults
          </Button>
          <div className="flex gap-2 sm:justify-end">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleSave} loading={saving} disabled={loading}>
              Save Changes
            </Button>
          </div>
        </div>
      )}
    >
      {loading ? (
        <div className="py-10 text-center text-text-muted">Loading pricing data...</div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="rounded-[10px] border border-border-subtle bg-surface-2 p-3 text-sm">
            <p className="mb-1 font-medium text-text-main">Pricing Rates Format</p>
            <p className="text-text-muted">
              All rates are in <strong className="text-text-main">dollars per million tokens</strong> ($/1M tokens).
              Example: input rate of 2.50 means $2.50 per 1,000,000 input tokens.
            </p>
          </div>

          {allProviders.map((provider) => {
            const models = Object.keys(pricingData[provider] || {}).sort();
            return (
              <div
                key={provider}
                className="overflow-hidden rounded-[12px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)]"
              >
                <div className="border-b border-border-subtle bg-surface-2 px-4 py-2.5 text-sm font-semibold tracking-wide text-text-main">
                  {provider.toUpperCase()}
                  <span className="ml-2 text-xs font-normal text-text-muted">
                    {models.length} model{models.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="border-b border-border-subtle bg-bg text-xs uppercase tracking-wide text-text-muted">
                        <th className="px-3 py-2 text-left font-semibold">Model</th>
                        {PRICING_FIELDS.map((field) => (
                          <th key={field} className="px-3 py-2 text-right font-semibold">
                            {FIELD_LABELS[field]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {models.map((model) => (
                        <tr key={model} className="bg-surface transition-colors hover:bg-surface-2/70">
                          <td className="px-3 py-2 font-mono text-xs font-medium text-text-main">
                            {model}
                          </td>
                          {PRICING_FIELDS.map((field) => (
                            <td key={field} className="px-3 py-2">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={pricingData[provider][model]?.[field] ?? 0}
                                onChange={(e) => handlePricingChange(provider, model, field, e.target.value)}
                                aria-label={provider + " " + model + " " + FIELD_LABELS[field] + " rate"}
                                className="w-24 rounded-[8px] border border-border bg-surface-2 px-2 py-1.5 text-right font-mono text-xs text-text-main outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          {allProviders.length === 0 && (
            <div className="rounded-[12px] border border-dashed border-border py-10 text-center text-text-muted">
              No pricing data available
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
