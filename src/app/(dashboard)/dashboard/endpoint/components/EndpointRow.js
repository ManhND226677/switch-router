"use client";

import { Input } from "@/shared/components";

const TONE_CLASSES = {
  accent: "bg-primary/10 text-primary",
  office: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  muted: "bg-surface-2 text-text-muted",
};

/**
 * One copyable base URL.
 *
 * The row uses a fixed three-column grid so every endpoint keeps the same
 * rhythm: label, URL, actions. Descriptions and route chips start under the
 * URL column instead of using an approximate padding offset, which keeps them
 * aligned even when a label is longer (for example "Claude for M365").
 */
export default function EndpointRow({
  label,
  url,
  copyId,
  copied,
  onCopy,
  badge,
  tone = "muted",
  desc,
  routes,
  actions,
}) {
  const badgeClass = TONE_CLASSES[tone] || TONE_CLASSES.muted;

  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 sm:grid-cols-[8.5rem_minmax(0,1fr)_auto]">
      <span
        className={`flex h-6 w-full items-center justify-center rounded px-1.5 py-0.5 font-mono text-xs leading-none whitespace-nowrap ${badgeClass}`}
        title={badge ? `${label} (${badge})` : label}
      >
        {label}
      </span>

      <Input
        value={url}
        readOnly
        className="min-w-0"
        inputClassName="font-mono text-sm"
      />

      <div className="flex items-center justify-end gap-1">
        <button
          onClick={() => onCopy(url, copyId)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
          title={`Copy ${url}`}
          type="button"
        >
          <span className="material-symbols-outlined text-lg">
            {copied === copyId ? "check" : "content_copy"}
          </span>
        </button>
        {actions}
      </div>

      {(desc || routes?.length) && (
        <div className="col-start-2 col-end-4 min-w-0">
          {desc && <p className="text-xs leading-5 text-text-muted">{desc}</p>}
          {routes?.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {routes.map((route) => (
                <code
                  key={route}
                  className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs leading-4 text-text-muted"
                >
                  {route.replace(/\s+/g, " ")}
                </code>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
