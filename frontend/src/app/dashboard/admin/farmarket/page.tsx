import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FarMarketAdminView } from "./FarMarketAdminView";
import type { AdminAd } from "./FarMarketAdminView";

export const dynamic = "force-dynamic";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type AdminPage<T> = {
  items: T[];
  total: number;
};

async function fetchAdminAds(
  token: string,
): Promise<AdminPage<AdminAd>> {
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

export default async function AdminFarMarketPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const adsPage = await fetchAdminAds(session.access_token);

  return (
    <FarMarketAdminView
      ads={adsPage.items}
      adTotal={adsPage.total}
      accessToken={session.access_token}
    />
  );
}
