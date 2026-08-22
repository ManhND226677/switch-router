import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// The endpoint view moved into the merged /dashboard page (default tab).
// Kept as an alias so existing bookmarks and landing-page links keep working.
export default function EndpointRedirect() {
  redirect("/dashboard");
}
