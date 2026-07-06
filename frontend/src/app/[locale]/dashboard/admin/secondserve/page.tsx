import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SecondServeAdminView } from "./SecondServeAdminView";
import type { SsOrder, SsPage, SsStats, SsTicket, SsUser } from "./types";

export const dynamic = "force-dynamic";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function getJson<T>(path: string, token: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${API_BASE}/api/v1${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

const emptyPage = <T,>(): SsPage<T> => ({
  items: [],
  total: 0,
  page: 0,
  page_size: 0,
});

export default async function AdminSecondServePage() {
  const locale = await getLocale();
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return redirect({ href: "/login", locale });

  const token = session.access_token;

  const [users, partners, orders, tickets, stats] = await Promise.all([
    getJson<SsPage<SsUser>>("/admin/secondserve/users?page_size=50", token, emptyPage()),
    getJson<SsPage<SsUser>>(
      "/admin/secondserve/partners?page_size=100",
      token,
      emptyPage(),
    ),
    getJson<SsPage<SsOrder>>(
      "/admin/secondserve/orders?page_size=100",
      token,
      emptyPage(),
    ),
    getJson<SsPage<SsTicket>>(
      "/admin/secondserve/support?page_size=100",
      token,
      emptyPage(),
    ),
    getJson<SsStats | null>("/admin/secondserve/stats", token, null),
  ]);

  return (
    <SecondServeAdminView
      accessToken={token}
      users={users.items}
      usersTotal={users.total}
      partners={partners.items}
      orders={orders.items}
      ordersTotal={orders.total}
      tickets={tickets.items}
      stats={stats}
    />
  );
}
