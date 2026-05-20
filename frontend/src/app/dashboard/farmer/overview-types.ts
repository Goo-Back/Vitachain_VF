/**
 * KAT-14 — wire-side types for /api/v1/katara/farmers/me/overview.
 *
 * Mirrors backend/app/modules/katara/schemas.py (FarmerOverviewResponse).
 * Decimal-shaped fields (surface_area_ha, total_surface_ha) arrive as
 * strings on the wire — PostgREST + Pydantic Decimal both serialise that
 * way — so the type reflects that and consumers cast with Number() at the
 * formatting boundary.
 */

export type ParcelOverviewEntry = {
  parcel_id: string;
  name: string;
  crop_type: string;
  surface_area_ha: string;
  device_active_count: number;
  device_offline_count: number;
  device_pending_count: number;
  device_unlinked_count: number;
  last_reading_at: string | null;
  last_soil_moisture: number | null;
  has_open_threshold_breach: boolean;
};

export type FarmKpiRollup = {
  parcel_count: number;
  total_surface_ha: string;
  device_active_count: number;
  device_offline_count: number;
  device_pending_count: number;
  device_unlinked_count: number;
  parcels_with_open_breach: number;
};

export type FarmerOverviewResponse = {
  kpi: FarmKpiRollup;
  parcels: ParcelOverviewEntry[];
};
