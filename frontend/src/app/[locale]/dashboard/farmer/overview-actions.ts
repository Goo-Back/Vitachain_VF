"use server";

import { authedApiFetch } from "@/lib/api/authed-fetch";

import type { FarmerOverviewResponse } from "./overview-types";

/**
 * KAT-14 — server action wrapping GET /katara/farmers/me/overview.
 *
 * Delegates to the shared authedApiFetch helper (see ../parcels/actions.ts),
 * which self-heals a stale verification_status JWT claim by refreshing the
 * token and retrying once.
 */

export async function fetchFarmerOverview(): Promise<FarmerOverviewResponse | null> {
  let r: Response;
  try {
    r = await authedApiFetch("/katara/farmers/me/overview", { timeoutMs: 10_000 });
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
    open_alert_count: 0,
  };
}
