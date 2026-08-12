import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST() {
  const cookieStore = await cookies();
  for (const name of ["auth_token", "oidc_state", "oidc_nonce", "oidc_code_verifier"]) {
    cookieStore.delete(name);
  }
  return NextResponse.json({ success: true, dashboardAuthDisabled: true }, {
    headers: { "Cache-Control": "no-store" },
  });
}
