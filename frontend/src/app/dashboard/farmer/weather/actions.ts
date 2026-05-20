"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Thin proxy over GET /api/v1/katara/parcels/{id}/weather.
 *
 * The OpenWeatherMap API key lives backend-only (AUTH-05). The backend
 * handler reuses the cached owm_client.fetch_weather() shipped for KAT-08
 * (3 h DB cache by quantised lat/lng), so this action is essentially free.
 *
 * Wire shape comes from backend WeatherResponse (schemas.py); we mirror it
 * here in TS so the page stays strictly typed.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type WeatherIconKind = "sun" | "cloud" | "rain" | "snow" | "storm" | "fog";

export type WeatherCurrent = {
  city_label: string;
  temp_c: number;
  feels_like_c: number;
  description: string;
  icon_kind: WeatherIconKind;
  humidity_pct: number;
  wind_kmh: number;
  wind_dir: string;
  rain_mm_3h: number;
  temp_min_c: number;
  temp_max_c: number;
};

export type WeatherHourly = {
  iso: string;
  temp_c: number;
  icon_kind: WeatherIconKind;
  pop_pct: number;
};

export type WeatherDaily = {
  iso: string;
  temp_min_c: number;
  temp_max_c: number;
  icon_kind: WeatherIconKind;
  pop_pct: number;
  rain_mm: number;
};

export type WeatherResponse = {
  parcel_id: string;
  current: WeatherCurrent;
  hourly: WeatherHourly[];
  daily: WeatherDaily[];
  fetched_at: string;
};

export async function fetchWeatherForParcel(
  parcelId: string,
): Promise<WeatherResponse | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  let r: Response;
  try {
    r = await fetch(
      `${API_BASE}/api/v1/katara/parcels/${parcelId}/weather`,
      {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    return null;
  }
  if (!r.ok) return null;
  return (await r.json()) as WeatherResponse;
}
