// INF-08 — Sentry edge-runtime init. Runs in Next.js middleware + edge routes.
// The Edge runtime is a constrained subset of Node — Sentry exposes a separate
// init entrypoint so the SDK only pulls the integrations that are edge-safe.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const env = process.env.NEXT_PUBLIC_VITACHAIN_ENV ?? "dev";

if (dsn && env !== "dev") {
  Sentry.init({
    dsn,
    environment: env,
    release: process.env.NEXT_PUBLIC_GIT_SHA ?? "unknown",
    tracesSampleRate: 0.1,
  });
}
