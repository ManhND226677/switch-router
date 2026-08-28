import { Suspense } from "react";
import ErrorAnalyticsClient from "./ErrorAnalyticsClient";
import { CardSkeleton } from "@/shared/components";

export const dynamic = "force-dynamic";
export const metadata = { title: "Error Analytics — Switch Router" };

// Dedicated error analytics page: aggregates requestDetails failures by
// provider/model, shows daily burst view + recent error rows.
export default function ErrorsPage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <ErrorAnalyticsClient />
    </Suspense>
  );
}
