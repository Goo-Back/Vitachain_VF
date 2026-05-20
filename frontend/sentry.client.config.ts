// INF-08 — Sentry browser-side init. Runs in the user's browser.
//
// RUM Replay is explicitly OFF (story §2 out-of-scope) — PII surface area +
// bundle weight outweigh the value at MVD scope. BrowserTracing stays on at
// the same 0.1 sample rate as the backend so route transitions + fetch
// waterfalls are visible when an issue lands in the UI.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const env = process.env.NEXT_PUBLIC_VITACHAIN_ENV ?? "dev";

if (dsn && env !== "dev") {
  Sentry.init({
    dsn,
    environment: env,
    release: process.env.NEXT_PUBLIC_GIT_SHA ?? "unknown",
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    integrations: [Sentry.browserTracingIntegration()],
  });
}
