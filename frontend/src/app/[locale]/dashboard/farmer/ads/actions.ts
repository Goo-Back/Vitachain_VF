"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";

import { authedApiFetch } from "@/lib/api/authed-fetch";

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

export async function fetchMyAds(): Promise<Ad[]> {
  let r: Response;
  try {
    r = await authedApiFetch("/farmarket/ads");
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
  // We must NOT set Content-Type — the boundary is set from the FormData body.
  let r: Response;
  try {
    r = await authedApiFetch("/farmarket/ads", {
      method: "POST",
      body: formData,
      timeoutMs: 30_000,
    });
  } catch (e) {
    return {
      error:
        e instanceof Error && e.message === "not_authenticated"
          ? "not_authenticated"
          : "network_error",
    };
  }

  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { detail?: unknown };
    const detail =
      typeof body.detail === "string" ? body.detail : `request_failed:${r.status}`;
    return { error: detail };
  }

  revalidatePath("/dashboard/farmer/ads");
  return redirect({ href: "/dashboard/farmer/ads", locale: await getLocale() });
}

export type AdUpdateFormState = { error: string | null };

export async function updateAd(
  adId: string,
  _prev: AdUpdateFormState,
  formData: FormData,
): Promise<AdUpdateFormState> {
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
    r = await authedApiFetch(`/farmarket/ads/${adId}`, {
      method: "PATCH",
      body: formData,
      timeoutMs: 30_000,
    });
  } catch (e) {
    return {
      error:
        e instanceof Error && e.message === "not_authenticated"
          ? "not_authenticated"
          : "network_error",
    };
  }

  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { detail?: unknown };
    const detail =
      typeof body.detail === "string" ? body.detail : `request_failed:${r.status}`;
    return { error: detail };
  }

  revalidatePath("/dashboard/farmer/ads");
  return redirect({ href: "/dashboard/farmer/ads", locale: await getLocale() });
}

export async function deleteAd(adId: string): Promise<{ error: string | null }> {
  let r: Response;
  try {
    r = await authedApiFetch(`/farmarket/ads/${adId}`, { method: "DELETE" });
  } catch (e) {
    return {
      error:
        e instanceof Error && e.message === "not_authenticated"
          ? "not_authenticated"
          : "network_error",
    };
  }

  if (!r.ok && r.status !== 204) {
    const body = (await r.json().catch(() => ({}))) as { detail?: unknown };
    const detail =
      typeof body.detail === "string" ? body.detail : `request_failed:${r.status}`;
    return { error: detail };
  }

  revalidatePath("/dashboard/farmer/ads");
  return redirect({ href: "/dashboard/farmer/ads", locale: await getLocale() });
}

export async function fetchAdById(adId: string): Promise<Ad | null> {
  let r: Response;
  try {
    r = await authedApiFetch("/farmarket/ads");
  } catch {
    return null;
  }
  if (!r.ok) return null;
  const ads = (await r.json()) as Ad[];
  return ads.find((a) => a.id === adId) ?? null;
}
