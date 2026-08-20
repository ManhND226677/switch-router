import { redirect } from "next/navigation";

// Legacy bookmark — dashboard auth is disabled (local-only).
export default function LoginPage() {
  redirect("/dashboard");
}
