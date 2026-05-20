// Liveness endpoint — consumed by:
//   - the container HEALTHCHECK (Dockerfile)
//   - NGINX `/healthz` proxy (later, INF-06)
//   - Uptime Kuma (INF-08)
//
// Must stay free of any auth / DB call: it answers "is the Node process up"
// and nothing else. Readiness (DB reachable, Supabase responding) will live
// on a separate `/api/readyz` introduced when load-testing in P3.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return Response.json({ ok: true, service: "frontend" });
}
