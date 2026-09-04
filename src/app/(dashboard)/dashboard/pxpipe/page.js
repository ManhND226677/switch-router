import { redirect } from "next/navigation";
import { getSettings } from "@/lib/localDb";
import PxpipeClient from "./PxpipeClient";

export const dynamic = "force-dynamic";

// Pxpipe is an optional feature — hidden entirely when the Optional-features
// toggle is off. The page stays reachable only while pxpipeEnabled is true.
export default async function PxpipePage() {
  const settings = await getSettings();
  if (settings?.pxpipeEnabled !== true) {
    redirect("/dashboard/profile");
  }
  return <PxpipeClient />;
}
