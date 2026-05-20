"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * KAT-01 — server actions wrapping the FastAPI /katara/parcels endpoints.
 *
 * Same pattern as AUTH-06 onboarding/verification/actions.ts: the browser
 * never sees the raw bearer token. The Supabase session cookie (kept fresh
 * by the middleware) is read server-side, and the access_token is forwarded
 * to FastAPI as `Authorization: Bearer …`.
 *
 * INF-05 grep-fails the build if a service-role symbol appears in frontend/;
 * the user's JWT is the only credential that flows through here.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Parcel = {
  id: string;
  farmer_id: string;
  name: string;
  geojson: Record<string, unknown>;
  crop_type: string;
  surface_area_ha: string;
  created_at: string;
  updated_at: string;
};

export type CreateParcelInput = {
  name: string;
  crop_type: string;
  surface_area_ha: number;
  geojson: Record<string, unknown>;
};

export type UpdateParcelInput = Partial<CreateParcelInput>;

export type CreateParcelResult =
  | { ok: true; parcel: Parcel }
  | { ok: false; error: string };

export type UpdateParcelResult = CreateParcelResult;

async function _authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new Error("not_authenticated");
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${API_BASE}/api/v1${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
}

export async function fetchMyParcels(): Promise<Parcel[]> {
  // Network-level failures (backend down, refused connection) bubble up as
  // a TypeError("fetch failed") and used to crash any page that called this.
  // Catching them here lets the parcel selectors on /weather, /satellite
  // and the list page degrade to an empty state — same posture as a 401/403.
  let r: Response;
  try {
    r = await _authedFetch("/katara/parcels");
  } catch {
    return [];
  }
  if (!r.ok) {
    if (r.status === 403 || r.status === 401) return [];
    return [];
  }
  return (await r.json()) as Parcel[];
}

export async function fetchParcel(id: string): Promise<Parcel | null> {
  let r: Response;
  try {
    r = await _authedFetch(`/katara/parcels/${id}`);
  } catch {
    return null;
  }
  if (r.status === 404 || r.status === 403 || r.status === 401) return null;
  if (!r.ok) return null;
  return (await r.json()) as Parcel;
}

export async function createParcel(
  input: CreateParcelInput,
): Promise<CreateParcelResult> {
  const r = await _authedFetch("/katara/parcels", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { detail?: unknown };
    const detail =
      typeof body.detail === "string"
        ? body.detail
        : `request_failed:${r.status}`;
    return { ok: false, error: detail };
  }
  const parcel = (await r.json()) as Parcel;
  // List page is RSC + force-dynamic, but tag the path so the next
  // navigation re-fetches even if Next decided to keep a cached entry.
  revalidatePath("/dashboard/farmer/parcels");
  return { ok: true, parcel };
}

/**
 * Server-action form handler. Used by the registration form's `action={…}`
 * so the redirect can happen server-side on success, and the validation
 * error surfaces back to the client without leaving the page.
 */
export async function submitParcelForm(
  _prev: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const name = String(formData.get("name") ?? "").trim();
  const cropTypeRaw = String(formData.get("crop_type") ?? "").trim();
  const cropTypeCustom = String(formData.get("crop_type_custom") ?? "").trim();
  const cropType = cropTypeRaw === "__autre__" ? cropTypeCustom : cropTypeRaw;
  const areaRaw = String(formData.get("surface_area_ha") ?? "").trim();
  const geojsonRaw = String(formData.get("geojson") ?? "").trim();

  if (!name) return { error: "name_required" };
  if (!cropType) return { error: "crop_type_required" };

  const surface = Number(areaRaw);
  if (!Number.isFinite(surface) || surface <= 0) {
    return { error: "surface_area_invalid" };
  }

  let geojson: Record<string, unknown>;
  try {
    geojson = JSON.parse(geojsonRaw) as Record<string, unknown>;
  } catch {
    return { error: "geojson_syntax" };
  }

  const result = await createParcel({
    name,
    crop_type: cropType,
    surface_area_ha: surface,
    geojson,
  });

  if (!result.ok) return { error: result.error };

  redirect("/dashboard/farmer/parcels");
}

// ── Update ────────────────────────────────────────────────────────────────────

export async function updateParcel(
  id: string,
  input: UpdateParcelInput,
): Promise<UpdateParcelResult> {
  let r: Response;
  try {
    r = await _authedFetch(`/katara/parcels/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, error: "network_error" };
  }
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { detail?: unknown };
    const detail =
      typeof body.detail === "string"
        ? body.detail
        : `request_failed:${r.status}`;
    return { ok: false, error: detail };
  }
  const parcel = (await r.json()) as Parcel;
  revalidatePath("/dashboard/farmer/parcels");
  revalidatePath(`/dashboard/farmer/parcels/${id}`);
  return { ok: true, parcel };
}

export async function submitUpdateParcelForm(
  parcelId: string,
  _prev: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const name = String(formData.get("name") ?? "").trim();
  const cropTypeRaw = String(formData.get("crop_type") ?? "").trim();
  const cropTypeCustom = String(formData.get("crop_type_custom") ?? "").trim();
  const cropType = cropTypeRaw === "__autre__" ? cropTypeCustom : cropTypeRaw;
  const areaRaw = String(formData.get("surface_area_ha") ?? "").trim();
  const geojsonRaw = String(formData.get("geojson") ?? "").trim();

  if (!name) return { error: "name_required" };
  if (!cropType) return { error: "crop_type_required" };

  const surface = Number(areaRaw);
  if (!Number.isFinite(surface) || surface <= 0) {
    return { error: "surface_area_invalid" };
  }

  let geojson: Record<string, unknown>;
  try {
    geojson = JSON.parse(geojsonRaw) as Record<string, unknown>;
  } catch {
    return { error: "geojson_syntax" };
  }

  const result = await updateParcel(parcelId, {
    name,
    crop_type: cropType,
    surface_area_ha: surface,
    geojson,
  });

  if (!result.ok) return { error: result.error };

  redirect(`/dashboard/farmer/parcels/${parcelId}`);
}

// ── Delete ────────────────────────────────────────────────────────────────────

export async function deleteParcel(
  parcelId: string,
): Promise<{ ok: false; error: string }> {
  let ok = false;
  try {
    const r = await _authedFetch(`/katara/parcels/${parcelId}`, {
      method: "DELETE",
    });
    ok = r.ok;
  } catch {
    return { ok: false, error: "network_error" };
  }
  if (!ok) return { ok: false, error: "delete_failed" };
  revalidatePath("/dashboard/farmer/parcels");
  redirect("/dashboard/farmer/parcels");
}
