"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type IncomingItem = {
  id: string;
  order_id: string;
  resto_handle: string;
  ad_id: string;
  quantity_kg: string;
  unit_price_mad: string;
  line_total_mad: string;
  status:
    | "PENDING"
    | "ACCEPTED"
    | "REJECTED"
    | "PICKED_UP"
    | "IN_TRANSIT"
    | "DELIVERED";
  producer_note: string | null;
  delivery_region: string;
  created_at: string;
  updated_at: string;
};

async function _session() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}

export async function fetchIncomingItems(): Promise<IncomingItem[]> {
  const session = await _session();
  if (!session) return [];

  let r: Response;
  try {
    r = await fetch(`${API_BASE}/api/v1/farmarket/orders/incoming`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return [];
  }
  if (!r.ok) return [];
  return (await r.json()) as IncomingItem[];
}

export type ItemStatusInput = {
  new_status: IncomingItem["status"];
  producer_note?: string | null;
};

export async function updateItemStatus(
  itemId: string,
  input: ItemStatusInput,
): Promise<{ ok: boolean; error?: string }> {
  const session = await _session();
  if (!session) return { ok: false, error: "not_authenticated" };

  let r: Response;
  try {
    r = await fetch(
      `${API_BASE}/api/v1/farmarket/orders/items/${itemId}/status`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          new_status: input.new_status,
          producer_note: input.producer_note ?? null,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    return { ok: false, error: "network_error" };
  }

  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { detail?: unknown };
    const detail =
      typeof body.detail === "string" ? body.detail : `request_failed:${r.status}`;
    return { ok: false, error: detail };
  }

  revalidatePath("/dashboard/farmer/orders");
  return { ok: true };
}
