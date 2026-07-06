"use server";

/**
 * KAT-04 — server action wrapping the FastAPI telemetry read endpoints.
 *
 * Mirrors the pattern in [./actions.ts]: the browser never sees the raw
 * bearer token at SSR time; the Supabase session cookie is read server-side
 * and the access_token is forwarded to FastAPI. The polling fetches on the
 * client side reuse a short-lived access_token that the server page hands to
 * the client component as a prop (refreshed on each Next.js render).
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Window = "24h" | "7d" | "30d";
export type Granularity = "15min" | "1hour" | "1day";
export type DeviceStatus = "PENDING" | "ACTIVE" | "OFFLINE" | "UNLINKED";

export interface LatestTelemetry {
  device_id: string;
  /** KAT-13 — human-readable ESP-KAT-NNN label. Nullable because the
   *  underlying view exposes the join column; older clients still tolerate
   *  the field being absent. */
  device_label?: string | null;
  /** KAT-13 — current status of the device that produced this reading.
   *  Drives the "Détaché" pill on the latest tile. */
  device_status?: DeviceStatus | null;
  /** KAT-13 — when the device was unlinked. Populated only when
   *  `device_status === "UNLINKED"`. */
  device_unlinked_at?: string | null;
  soil_moisture: number;
  soil_temperature: number;
  soil_ph: number;
  soil_conductivity: number;
  battery_level: number;
  recorded_at: string;
  received_at: string;
}

export interface HistoryBucket {
  bucket: string;
  soil_moisture: number;
  soil_temperature: number;
  soil_ph: number;
  soil_conductivity: number;
  battery_level: number;
  sample_count: number;
  device_count: number;
}

export interface HistoryResponse {
  window: Window;
  granularity: Granularity;
  point_count: number;
  buckets: HistoryBucket[];
}

/** KAT-13 — one device's contribution to the parcel's telemetry. The list
 *  surfaces both currently-paired devices and historically-paired devices
 *  whose `device_status === "UNLINKED"`. */
export interface DeviceHistoryEntry {
  device_uuid: string;
  /** ESP-KAT-NNN — the human-readable id printed on the device case. */
  device_id: string;
  device_status: DeviceStatus;
  api_key_last4: string | null;
  first_recorded_at: string;
  last_recorded_at: string;
  sample_count: number;
  is_currently_paired: boolean;
  /** Proxy for the unlink timestamp on UNLINKED rows; equals the row's
   *  last `updated_at` (KAT-12 freeze trigger forbids other mutations on
   *  UNLINKED rows). On non-UNLINKED rows it is just the device's last
   *  update time. */
  device_updated_at: string;
}

export interface DeviceHistoryResponse {
  devices: DeviceHistoryEntry[];
}

export interface InitialTelemetry {
  latest: LatestTelemetry | null;
  history: HistoryResponse;
  /** KAT-13 — never empty for a parcel with telemetry; falls back to `[]`
   *  on a network error so the page still renders. */
  devicesHistory: DeviceHistoryEntry[];
}

const _EMPTY_HISTORY: HistoryResponse = {
  window: "24h",
  granularity: "15min",
  point_count: 0,
  buckets: [],
};

/**
 * Initial paint: most-recent reading + the default 24h history. On-focus
 * polling lives client-side (see TelemetrySection.tsx) so this only runs once
 * per page navigation.
 *
 * A 404 on `/latest` means the parcel doesn't exist or isn't yours — caller
 * surfaces this as a notFound(). Any other non-200 is degraded gracefully to
 * an empty-state so the dashboard page renders rather than crashing.
 */
export async function fetchInitialTelemetry(
  parcelId: string,
  accessToken?: string,
): Promise<InitialTelemetry> {
  let token = accessToken;
  if (!token) {
    const supabase = await createSupabaseServerClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("not_authenticated");
    token = session.access_token;
  }

  const headers = { Authorization: `Bearer ${token}` };
  const signal = AbortSignal.timeout(10_000);

  let latestRes: Response, historyRes: Response, devicesHistoryRes: Response;
  try {
    [latestRes, historyRes, devicesHistoryRes] = await Promise.all([
      fetch(`${API_BASE}/api/v1/katara/parcels/${parcelId}/telemetry/latest`, { headers, cache: "no-store", signal }),
      fetch(`${API_BASE}/api/v1/katara/parcels/${parcelId}/telemetry/history?window=24h`, { headers, cache: "no-store", signal }),
      fetch(`${API_BASE}/api/v1/katara/parcels/${parcelId}/devices-history`, { headers, cache: "no-store", signal }),
    ]);
  } catch {
    return { latest: null, history: _EMPTY_HISTORY, devicesHistory: [] };
  }

  if (latestRes.status === 404) {
    throw new Error("parcel_not_found");
  }

  const latest =
    latestRes.status === 204 || !latestRes.ok
      ? null
      : ((await latestRes.json()) as LatestTelemetry);

  const history = historyRes.ok
    ? ((await historyRes.json()) as HistoryResponse)
    : _EMPTY_HISTORY;

  const devicesHistory = devicesHistoryRes.ok
    ? ((await devicesHistoryRes.json()) as DeviceHistoryResponse).devices
    : [];

  return { latest, history, devicesHistory };
}
