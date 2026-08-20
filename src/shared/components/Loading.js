"use client";

import { cn } from "@/shared/utils/cn";

function Spinner({ size = "md", className }) {
  const sizes = {
    sm: "size-4",
    md: "size-6",
    lg: "size-8",
    xl: "size-12",
  };

  return (
    <span
      className={cn(
        "material-symbols-outlined animate-spin text-brand-500",
        sizes[size],
        className
      )}
    >
      progress_activity
    </span>
  );
}

function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-[10px] bg-surface-2",
        className
      )}
      {...props}
    />
  );
}

// Card skeleton — primary loading placeholder used across dashboard pages
export function CardSkeleton() {
  return (
    <div className="p-6 rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="size-10 rounded-[10px]" />
      </div>
      <Skeleton className="h-8 w-16 mb-2" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

export default function Loading({ type = "spinner", ...props }) {
  switch (type) {
    case "card":
      return <CardSkeleton {...props} />;
    case "skeleton":
      return <Skeleton {...props} />;
    default:
      return <Spinner {...props} />;
  }
}
