"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Shared OAuth callback content.
 *
 * Unstoppable Code's desktop-auth page only accepts the exact callback path its
 * own loopback server registers (`/canopy-cloud/oauth/callback`), and rejects
 * anything else with "Unable to connect desktop app". This shared component is
 * mounted at BOTH /callback (generic providers) and
 * /canopy-cloud/oauth/callback (Unstoppable) so the relay logic stays in one
 * place while each provider gets the path its authorize page expects.
 */
export function OAuthCallbackContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("processing");

  /* eslint-disable react-hooks/set-state-in-effect -- OAuth callback intentionally updates UI after relaying the code. */
  useEffect(() => {
    const code = searchParams.get("code");
    const token = searchParams.get("token");
    const state = searchParams.get("state");
    const error = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");

    const callbackData = {
      code,
      token,
      state,
      error,
      errorDescription,
      fullUrl: window.location.href,
    };

    // The dashboard may be served from localhost or 127.0.0.1 on the same port;
    // Unstoppable forces 127.0.0.1 in its redirect_uri, so the opener's origin
    // can differ from this page's origin even on a local machine.
    const expectedOrigins = [
      window.location.origin,
      "http://localhost:1455",
      `http://localhost:${window.location.port}`,
      `http://127.0.0.1:${window.location.port}`,
    ];

    if (window.opener) {
      for (const origin of expectedOrigins) {
        try {
          window.opener.postMessage({ type: "oauth_callback", data: callbackData }, origin);
        } catch (e) {
          console.log("postMessage failed:", e);
        }
      }
    }

    try {
      const channel = new BroadcastChannel("oauth_callback");
      channel.postMessage(callbackData);
      channel.close();
    } catch (e) {
      console.log("BroadcastChannel failed:", e);
    }

    try {
      localStorage.setItem("oauth_callback", JSON.stringify({ ...callbackData, timestamp: Date.now() }));
    } catch (e) {
      console.log("localStorage failed:", e);
    }

    if (!(code || token || error)) {
      setTimeout(() => setStatus("manual"), 0);
      return;
    }

    setStatus("success");
    setTimeout(() => {
      window.close();
      setTimeout(() => setStatus("done"), 500);
    }, 1500);
  }, [searchParams]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="text-center p-8 max-w-md">
        {status === "processing" && (
          <>
            <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-primary animate-spin">progress_activity</span>
            </div>
            <h1 className="text-xl font-semibold mb-2">Processing...</h1>
            <p className="text-text-muted">Please wait while we complete the authorization.</p>
          </>
        )}

        {(status === "success" || status === "done") && (
          <>
            <div className="size-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-green-600">check_circle</span>
            </div>
            <h1 className="text-xl font-semibold mb-2">Authorization Successful!</h1>
            <p className="text-text-muted">
              {status === "success" ? "This window will close automatically..." : "You can close this tab now."}
            </p>
          </>
        )}

        {status === "manual" && (
          <>
            <div className="size-16 mx-auto mb-4 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-yellow-600">info</span>
            </div>
            <h1 className="text-xl font-semibold mb-2">Copy This URL</h1>
            <p className="text-text-muted mb-4">
              Please copy the URL from the address bar and paste it in the application.
            </p>
            <div className="bg-surface border border-border rounded-lg p-3 text-left">
              <code className="text-xs break-all">{typeof window !== "undefined" ? window.location.href : ""}</code>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Default export wrapper with Suspense for use as a page.
 */
export default function OAuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="text-center p-8">
          <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
            <span className="material-symbols-outlined text-3xl text-primary animate-spin">progress_activity</span>
          </div>
          <p className="text-text-muted">Loading...</p>
        </div>
      </div>
    }>
      <OAuthCallbackContent />
    </Suspense>
  );
}
