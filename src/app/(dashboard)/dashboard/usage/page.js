import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// The usage view moved into the merged /dashboard page (?tab=usage).
// Preserve the old sub-tab param so /dashboard/usage?tab=logs deep links
// land on the logs pane, not the overview.
export default async function UsageRedirect({ searchParams }) {
  const params = await searchParams;
  const target = new URLSearchParams();
  target.set("tab", "usage");
  if (params?.tab === "logs") target.set("sub", "logs");
  redirect(`/dashboard?${target.toString()}`);
}
