import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FarMarketAdminView } from "./FarMarketAdminView";
import type { AdminAd } from "./FarMarketAdminView";
import type { AdminOrderListItem, AdminStats } from "./types";

export const dynamic = "force-dynamic";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type AdminPage<T> = {
  items: T[];
  total: number;
};

async function fetchAdminAds(token: string): Promise<AdminPage<AdminAd>> {
  try {
    const res = await fetch(
      `${API_BASE}/api/v1/admin/farmarket/ads?page_size=50`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );
    if (!res.ok) return { items: [], total: 0 };
    return res.json();
  } catch {
    return { items: [], total: 0 };
  }
}

async function fetchOutstandingCod(
  token: string,
): Promise<AdminPage<AdminOrderListItem>> {
  try {
    const res = await fetch(
      `${API_BASE}/api/v1/admin/farmarket/orders?outstanding_cod=true&page_size=100`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );
    if (!res.ok) return { items: [], total: 0 };
    return res.json();
  } catch {
    return { items: [], total: 0 };
  }
}

async function fetchAllOrders(
  token: string,
): Promise<AdminPage<AdminOrderListItem>> {
  try {
    const res = await fetch(
      `${API_BASE}/api/v1/admin/farmarket/orders?page_size=100`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );
    if (!res.ok) return { items: [], total: 0 };
    return res.json();
  } catch {
    return { items: [], total: 0 };
  }
}

async function fetchStats(token: string): Promise<AdminStats | null> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/admin/farmarket/stats`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function AdminFarMarketPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const [adsPage, codPage, ordersPage, stats] = await Promise.all([
    fetchAdminAds(session.access_token),
    fetchOutstandingCod(session.access_token),
    fetchAllOrders(session.access_token),
    fetchStats(session.access_token),
  ]);

  return (
    <FarMarketAdminView
      ads={adsPage.items}
      adTotal={adsPage.total}
      outstandingCod={codPage.items}
      outstandingCodTotal={codPage.total}
      orders={ordersPage.items}
      ordersTotal={ordersPage.total}
      stats={stats}
      accessToken={session.access_token}
    />
  );
}
