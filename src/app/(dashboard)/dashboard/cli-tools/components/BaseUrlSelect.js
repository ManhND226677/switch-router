"use client";

import { useEffect, useMemo } from "react";
import { SERVER_CONFIG } from "@/shared/constants/config";

const ensureV1 = (url) => {
  const trimmed = (url || "").replace(/\/+$/, "");
  if (!trimmed) return "";
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
};

/**
 * The personal build always points CLI tools at this local Switch-Router.
 * Keeping this as a component preserves the existing card API while making
 * The endpoint selector intentionally exposes only the local Switch-Router URL.
 */
export default function BaseUrlSelect({ onChange, withV1 = true }) {
  const localUrl = useMemo(() => {
  const base = `http://127.0.0.1:${SERVER_CONFIG.appPort}`;
    return withV1 ? ensureV1(base) : base;
  }, [withV1]);

  useEffect(() => {
    onChange(localUrl);
  }, [localUrl, onChange]);

  return (
    <div className="flex flex-col gap-1.5">
      <input
        type="text"
        value={localUrl}
        readOnly
        aria-label="Local Switch-Router endpoint"
        className="w-full min-w-0 rounded border border-border bg-surface px-2 py-2 font-mono text-xs text-text-main focus:outline-none sm:py-1.5"
      />
      <span className="text-xs text-text-muted">Local endpoint only</span>
    </div>
  );
}
