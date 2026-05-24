"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Ad = {
  id: string;
  farmer_id: string;
  title: string;
  description: string;
  product_type: string;
  price_mad: string;
  quantity_kg: string;
  region: string;
  photo_paths: string[];
  photo_urls: string[];
  status: "ACTIVE" | "EXPIRED" | "DELETED";
  is_featured: boolean;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export type AdFormState = { error: string | null };

async function _authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("not_authenticated");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);
  return fetch(`${API_BASE}/api/v1${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
}

export async function fetchMyAds(): Promise<Ad[]> {
  let r: Response;
  try {
    r = await _authedFetch("/farmarket/ads");
  } catch {
    return [];
  }
  if (!r.ok) return [];
  return (await r.json()) as Ad[];
}

export async function submitAdForm(
  _prev: AdFormState,
  formData: FormData,
): Promise<AdFormState> {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const product_type = String(formData.get("product_type") ?? "").trim();
  const price_mad = String(formData.get("price_mad") ?? "").trim();
  const quantity_kg = String(formData.get("quantity_kg") ?? "").trim();
  const region = String(formData.get("region") ?? "").trim();

  if (!title) return { error: "title_required" };
  if (!description) return { error: "description_required" };
  if (!product_type) return { error: "product_type_required" };
  if (!price_mad || Number(price_mad) <= 0) return { error: "price_invalid" };
  if (!quantity_kg || Number(quantity_kg) <= 0) return { error: "quantity_invalid" };
  if (!region) return { error: "region_required" };

  // Re-use the original FormData for multipart (photos included).
  // We must NOT set Content-Type — the browser sets the boundary automatically.
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: "not_authenticated" };

  let r: Response;
  try {
    r = await fetch(`${API_BASE}/api/v1/farmarket/ads`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: formData,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { error: "network_error" };
  }

  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { detail?: unknown };
    const detail =
      typeof body.detail === "string" ? body.detail : `request_failed:${r.status}`;
    return { error: detail };
  }

  revalidatePath("/dashboard/farmer/ads");
  redirect("/dashboard/farmer/ads");
}

export type AdUpdateFormState = { error: string | null };

export async function updateAd(
  adId: string,
  _prev: AdUpdateFormState,
  formData: FormData,
): Promise<AdUpdateFormState> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: "not_authenticated" };

  const hasText =
    formData.get("title") ||
    formData.get("description") ||
    formData.get("product_type") ||
    formData.get("price_mad") ||
    formData.get("quantity_kg") ||
    formData.get("region");
  const photos = formData.getAll("photos") as File[];
  const hasPhotos = photos.some((f) => f.size > 0);
  if (!hasText && !hasPhotos) return { error: "no_fields_to_update" };

  let r: Response;
  try {
    r = await fetch(`${API_BASE}/api/v1/farmarket/ads/${adId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: formData,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { error: "network_error" };
  }

  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { detail?: unknown };
    const detail =
      typeof body.detail === "string" ? body.detail : `request_failed:${r.status}`;
    return { error: detail };
  }

  revalidatePath("/dashboard/farmer/ads");
  redirect(`/dashboard/farmer/ads`);
}

export async function deleteAd(adId: string): Promise<{ error: string | null }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: "not_authenticated" };

  let r: Response;
  try {
    r = await fetch(`${API_BASE}/api/v1/farmarket/ads/${adId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { error: "network_error" };
  }

  if (!r.ok && r.status !== 204) {
    const body = (await r.json().catch(() => ({}))) as { detail?: unknown };
    const detail =
      typeof body.detail === "string" ? body.detail : `request_failed:${r.status}`;
    return { error: detail };
  }

  revalidatePath("/dashboard/farmer/ads");
  redirect("/dashboard/farmer/ads");
}

export async function fetchAdById(adId: string): Promise<Ad | null> {
  let r: Response;
  try {
    r = await _authedFetch("/farmarket/ads");
  } catch {
    return null;
  }
  if (!r.ok) return null;
  const ads = (await r.json()) as Ad[];
  return ads.find((a) => a.id === adId) ?? null;
}
