import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// INF-03 — standalone output for slim Docker image; behind NGINX upstream (INF-01).
const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Server Actions are GA in Next 15 but keep the explicit allow-list so we
    // never accidentally accept cross-origin posts. Populated when domains land.
    serverActions: {
      allowedOrigins: ["vitachain.ma", "www.vitachain.ma", "localhost:3000"],
    },
  },
};

// INF-08 — Wrap the Next config with Sentry's plugin. Source maps are
// uploaded only when SENTRY_AUTH_TOKEN is present (CI-only env var), so a
// developer's local `next build` runs without needing a Sentry account.
// The maps are deleted from the client bundle after upload so they never
// reach the public served chunks.
export default withSentryConfig(nextConfig, {
  org: "vitachain",
  project: "vitachain-prod",
  silent: !process.env.CI,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  telemetry: false,
});
