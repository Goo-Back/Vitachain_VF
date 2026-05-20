// INF-08 — planted error page. Renders Next 404 when NEXT_PUBLIC_VITACHAIN_ENV
// is "prod" so the gate is shipped with the bundle, not enforced by NGINX.
// Used during the §10 DoD drill to prove the frontend Sentry pipeline is wired
// end-to-end. Remove the staging URL from chat threads after verification.
"use client";

import { notFound } from "next/navigation";

export default function SentryTestPage() {
  if (process.env.NEXT_PUBLIC_VITACHAIN_ENV === "prod") notFound();
  return (
    <main className="p-8 space-y-4">
      <h1 className="text-2xl font-semibold">INF-08 — Sentry planted error page</h1>
      <p className="text-sm text-gray-600">
        Clicking the button below throws a synchronous{" "}
        <code className="font-mono">Error</code>. If the Sentry pipeline is wired,
        an Issue titled &quot;INF-08 planted frontend test&quot; appears within
        ~60s.
      </p>
      <button
        type="button"
        className="border px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700"
        onClick={() => {
          throw new Error(
            "INF-08 planted frontend test — if you see this in Sentry, the pipeline is wired.",
          );
        }}
      >
        Throw
      </button>
    </main>
  );
}
