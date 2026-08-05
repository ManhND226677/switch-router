import { redirect } from "next/navigation";

export default function TokenSaverPage() {
  redirect("/dashboard/profile#token-saver");
}
