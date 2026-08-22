"use client";

// Dashboard root = overview only (KPI strip + usage trend + provider
// distribution + top billing + recent requests). Connection setup moved to
// Virtual Keys; the old Connection/Usage tabs are gone.
import { Suspense } from "react";
import { CardSkeleton } from "@/shared/components";
import UsageClient from "./endpoint/UsageClient";

export default function DashboardPage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <UsageClient />
    </Suspense>
  );
}
