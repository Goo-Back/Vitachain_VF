"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Thin proxy over GET /api/v1/katara/parcels/{id}/ndvi.
 *
 * The Sentinel Hub API key lives backend-only (AUTH-05). The backend handler
 * reuses sentinel_client.fetch_ndvi() (12 h DB cache by parcel) for the mean
 * + acquisition date, plus sentinel_client.fetch_ndvi_image() for the 512×512
 * RGBA PNG that the UI renders. ``image_data_url`` may be null when the
 * upstream PNG fetch fails but the mean succeeded (best-effort).
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type NdviResponse = {
  parcel_id: string;
  mean_ndvi: number;
  acquisition_date: string; // YYYY-MM-DD
  image_data_url: string | null;
};

export async function fetchNdviForParcel(
  parcelId: string,
): Promise<NdviResponse | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return null;

    const r = await fetch(`${API_BASE}/api/v1/katara/parcels/${parcelId}/ndvi`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return null;
    return (await r.json()) as NdviResponse;
  } catch {
    // Any failure (session read, network, timeout) degrades to "no NDVI
    // data" rather than throwing — this promise is awaited inside a
    // <Suspense>-streamed Server Component with no data-fetch-specific
    // error handling of its own.
    return null;
  }
}
