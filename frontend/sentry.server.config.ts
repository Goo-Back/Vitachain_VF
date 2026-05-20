// INF-08 — Sentry server-side init. Runs in the Node runtime (SSR + server
// actions). Same DSN as the client config — the events are tagged by the
// Sentry SDK with their runtime so the UI can distinguish.
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
