"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { authedApiFetch } from "@/lib/api/authed-fetch";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Ad } from "@/app/[locale]/dashboard/farmer/ads/actions";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ─── FAR-11 / FAR-12 — farmer public profile + ratings ──────────────────────

export type FarmerPublicProfile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  display_name: string;
  region: string | null;
  member_since: string;
  rating_avg: number | null;
  rating_count: number;
  active_ad_count: number;
};

export type FarmerRating = {
  id: string;
  farmer_id: string;
  reviewer_name: string;
  rating: number;
  review: string | null;
  created_at: string;
  updated_at: string;
};

export type MyRating = {
  can_rate: boolean;
  my_rating: FarmerRating | null;
};

export type SubmitRatingResult = { error: string | null };

async function _authed(path: string, init: RequestInit = {}): Promise<Response | null> {
  const { signal: _signal, ...rest } = init;
  try {
    return await authedApiFetch(path, { ...rest, timeoutMs: 10_000 });
  } catch {
    // Includes the "not_authenticated" throw — callers treat null as "no data".
    return null;
  }
}

export type CatalogPage = {
  items: Ad[];
  total: number;
  page: number;
  page_size: number;
  has_next: boolean;
};

export type CatalogFilters = {
  region?: string;
  product_type?: string;
  price_min?: string;
  price_max?: string;
  page?: number;
};

const EMPTY_PAGE: CatalogPage = {
  items: [],
  total: 0,
  page: 1,
  page_size: 20,
  has_next: false,
};

export async function fetchCatalog(
  filters: CatalogFilters = {},
): Promise<CatalogPage> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return EMPTY_PAGE;

  const qs = new URLSearchParams();
  if (filters.region) qs.set("region", filters.region);
  if (filters.product_type) qs.set("product_type", filters.product_type);
  if (filters.price_min) qs.set("price_min", filters.price_min);
  if (filters.price_max) qs.set("price_max", filters.price_max);
  if (filters.page && filters.page > 1) qs.set("page", String(filters.page));

  let r: Response;
  try {
    r = await fetch(
      `${API_BASE}/api/v1/farmarket/catalog?${qs.toString()}`,
      {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    return EMPTY_PAGE;
  }

  if (!r.ok) return EMPTY_PAGE;
  return (await r.json()) as CatalogPage;
}

/** Single-ad lookup via the dedicated GET /farmarket/ads/{id} endpoint. */
export async function fetchAdById(adId: string): Promise<Ad | null> {
  const r = await _authed(`/farmarket/ads/${adId}`);
  if (!r || !r.ok) return null;
  return (await r.json()) as Ad;
}

export async function fetchFarmerProfile(
  farmerId: string,
): Promise<FarmerPublicProfile | null> {
  const r = await _authed(`/farmarket/farmers/${farmerId}`);
  if (!r || !r.ok) return null;
  return (await r.json()) as FarmerPublicProfile;
}

export async function fetchFarmerAds(farmerId: string): Promise<Ad[]> {
  const r = await _authed(`/farmarket/farmers/${farmerId}/ads`);
  if (!r || !r.ok) return [];
  return (await r.json()) as Ad[];
}

export async function fetchFarmerRatings(
  farmerId: string,
): Promise<FarmerRating[]> {
  const r = await _authed(`/farmarket/farmers/${farmerId}/ratings`);
  if (!r || !r.ok) return [];
  return (await r.json()) as FarmerRating[];
}

export async function fetchMyRating(farmerId: string): Promise<MyRating> {
  const r = await _authed(`/farmarket/farmers/${farmerId}/ratings/me`);
  if (!r || !r.ok) return { can_rate: false, my_rating: null };
  return (await r.json()) as MyRating;
}

export async function submitRating(
  farmerId: string,
  input: { rating: number; review: string | null },
): Promise<SubmitRatingResult> {
  const t = await getTranslations("restaurant.marketplace.ratingErrors");
  if (input.rating < 1 || input.rating > 5) {
    return { error: t("ratingRangeError") };
  }
  const r = await _authed(`/farmarket/farmers/${farmerId}/ratings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating: input.rating, review: input.review }),
  });
  if (!r) return { error: t("connectionError") };
  if (r.status === 403) {
    return { error: t("notAllowedError") };
  }
  if (r.status === 404) {
    return { error: t("notFoundError") };
  }
  if (!r.ok) return { error: t("submitFailedError") };

  revalidatePath(`/dashboard/restaurant/marketplace/farmer/${farmerId}`);
  return { error: null };
}
