"use client";

import { DESIGN_OPTIONS } from "@/store/themeStore";
import { useTheme } from "@/shared/hooks/useTheme";

export default function DesignSwitcher() {
  const { design, setDesign } = useTheme();

  return (
    <div
      className="border-t border-border px-3 py-3"
      role="group"
      aria-label="Design"
    >
      <div className="mb-2 flex items-center gap-2 px-1 text-xs font-medium text-text-muted">
        <span className="material-symbols-outlined text-base" aria-hidden="true">
          palette
        </span>
        <span>Design</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {DESIGN_OPTIONS.map((option) => {
          const isSelected = option.id === design;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setDesign(option.id)}
              className={
                "flex min-w-0 flex-col items-center gap-1 rounded-md border px-1 py-1.5 text-[10px] transition-colors " +
                (isSelected
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-surface-2 text-text-muted hover:border-primary/40 hover:text-text-main")
              }
              aria-pressed={isSelected}
              title={option.label}
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">
                {option.icon}
              </span>
              <span className="truncate">{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
