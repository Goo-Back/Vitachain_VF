"use server";

import { authedApiFetch } from "@/lib/api/authed-fetch";

/**
 * Thin proxy over GET /api/v1/katara/parcels/{id}/telemetry/history.
 *
 * Mirrors [id]/telemetry-actions.ts's HistoryResponse shape, but only
 * exports the history call — the overview's TrendChart doesn't need
 * `latest` or `devices-history`, which fetchInitialTelemetry also fetches.
 */

export type TrendWindow = "24h" | "7d" | "30d";
export type TrendGranularity = "15min" | "1hour" | "1day";

export interface TrendHistoryBucket {
  bucket: string;
  soil_moisture: number;
  soil_temperature: number;
  soil_ph: number;
  soil_conductivity: number;
  battery_level: number;
  sample_count: number;
  device_count: number;
}

export interface TrendHistoryResponse {
  window: TrendWindow;
  granularity: TrendGranularity;
  point_count: number;
  buckets: TrendHistoryBucket[];
}

const _EMPTY: TrendHistoryResponse = {
  window: "7d",
  granularity: "1day",
  point_count: 0,
  buckets: [],
};

export async function fetchTelemetryHistory(
  parcelId: string,
  window: TrendWindow = "7d",
): Promise<TrendHistoryResponse> {
  let r: Response;
  try {
    r = await authedApiFetch(
      `/katara/parcels/${parcelId}/telemetry/history?window=${window}`,
      { timeoutMs: 10_000 },
    );
  } catch {
    return _EMPTY;
  }
  if (!r.ok) return _EMPTY;
  return (await r.json()) as TrendHistoryResponse;
}
