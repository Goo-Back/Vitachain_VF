"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import type { FarmerOverviewResponse } from "./overview-types";

/**
 * KAT-14 — server action wrapping GET /katara/farmers/me/overview.
 *
 * Same shape as ../parcels/actions.ts ::_authedFetch — the browser never
 * sees the raw bearer; the Supabase session cookie kept fresh by the
 * middleware is read server-side and forwarded as Authorization: Bearer …
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function fetchFarmerOverview(accessToken?: string): Promise<FarmerOverviewResponse | null> {
  let token = accessToken;
  if (!token) {
    const supabase = await createSupabaseServerClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    token = session.access_token;
  }

  let r: Response;
  try {
    r = await fetch(`${API_BASE}/api/v1/katara/farmers/me/overview`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }

  // A non-farmer (or a transient backend miss) sees the empty overview
  // rather than an error page — the dashboard remains usable.
  if (r.status === 401 || r.status === 403) {
    return { kpi: _zeroKpi(), parcels: [] };
  }
  if (!r.ok) {
    return null;
  }
  return (await r.json()) as FarmerOverviewResponse;
}

function _zeroKpi() {
  return {
    parcel_count: 0,
    total_surface_ha: "0.0000",
    device_active_count: 0,
    device_offline_count: 0,
    device_pending_count: 0,
    device_unlinked_count: 0,
    parcels_with_open_breach: 0,
  };
}
