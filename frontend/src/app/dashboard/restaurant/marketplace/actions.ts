"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Ad } from "@/app/dashboard/farmer/ads/actions";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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
