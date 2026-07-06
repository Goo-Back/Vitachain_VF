"use server";

/**
 * KAT-05 — server action wrapping the FastAPI threshold endpoints.
 *
 * Mirrors the pattern in ./telemetry-actions.ts: the Supabase session cookie
 * is read server-side and the access_token is forwarded to FastAPI. The PUT
 * lives client-side (see ThresholdsSection.tsx) so the optimistic-UI save
 * does not bounce through a server action round-trip.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Metric =
  | "soil_moisture"
  | "soil_temperature"
  | "soil_ph"
  | "soil_conductivity"
  | "battery_level";

export interface ThresholdRow {
  metric: Metric;
  min_value: number | null;
  max_value: number | null;
  enabled: boolean;
  last_alert_at?: string | null;
  last_alert_value?: number | null;
}

export interface ThresholdsResponse {
  parcel_id: string;
  rows: ThresholdRow[];
}

/**
 * Initial server-side fetch. A 404 from the API means the parcel is not
 * visible to the caller (RLS-filtered) — surface as null so the parcel page
 * can render the rest of the dashboard without the thresholds card.
 */
export async function fetchThresholds(
  parcelId: string,
  accessToken?: string,
): Promise<ThresholdsResponse | null> {
  let token = accessToken;
  if (!token) {
    const supabase = await createSupabaseServerClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("not_authenticated");
    token = session.access_token;
  }

  let r: Response;
  try {
    r = await fetch(
      `${API_BASE}/api/v1/katara/parcels/${parcelId}/thresholds`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    return null;
  }

  if (r.status === 404) return null;
  if (!r.ok) return null;
  return (await r.json()) as ThresholdsResponse;
}
