"use client";

import { useId } from "react";
import { cn } from "@/shared/utils/cn";

export default function Select({
  label,
  options = [],
  value,
  onChange,
  placeholder = "Select an option",
  error,
  hint,
  disabled = false,
  required = false,
  className,
  selectClassName,
  ...props
}) {
  const uid = useId();
  const selectId = `${uid}-select`;
  const errorId = `${uid}-error`;
  const hintId = `${uid}-hint`;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={selectId} className="text-sm font-medium text-text-main">
          {label}
          {required && <span aria-hidden="true" className="text-danger ml-1">*</span>}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          value={value}
          onChange={onChange}
          disabled={disabled}
          required={required}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          className={cn(
            "w-full py-2.5 px-3 pr-10 text-sm text-text-main",
            "bg-surface-2 border border-transparent rounded-[10px] appearance-none",
            "focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40",
            "transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed",
            "text-base sm:text-sm",
            error && "ring-1 ring-danger focus:ring-2 focus:ring-danger/40 border-danger/40",
            selectClassName
          )}
          {...props}
        >
          <option value="" disabled>
            {placeholder}
          </option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-text-muted">
          <span className="material-symbols-outlined text-xl">expand_more</span>
        </div>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger flex items-center gap-1">
          <span className="material-symbols-outlined text-sm">error</span>
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={hintId} className="text-xs text-text-muted">{hint}</p>
      )}
    </div>
  );
}
