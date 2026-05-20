// INF-08 — Next.js 15 instrumentation hook. Sentry server + edge init must
// live here so the SDK initialises before the first request.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}
