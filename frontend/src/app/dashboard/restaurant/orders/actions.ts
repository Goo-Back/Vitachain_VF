"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type OrderItem = {
  id: string;
  order_id: string;
  ad_id: string;
  farmer_id: string;
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
  created_at: string;
  updated_at: string;
};

export type Order = {
  id: string;
  restaurant_id: string;
  status:
    | "PENDING"
    | "PARTIALLY_ACCEPTED"
    | "ACCEPTED"
    | "REJECTED"
    | "IN_PROGRESS"
    | "DELIVERED"
    | "CANCELLED";
  delivery_region: string;
  delivery_notes: string | null;
  subtotal_mad: string;
  logistics_fee_mad: string;
  total_mad: string;
  payment_status: string;
  items: OrderItem[];
  created_at: string;
  updated_at: string;
};

export type PlaceOrderInput = {
  delivery_region: string;
  delivery_notes: string | null;
  items: { ad_id: string; quantity_kg: number }[];
};

export type PlaceOrderResult =
  | { ok: true; order: Order }
  | { ok: false; error: string };

async function _session() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}

export async function placeOrder(
  input: PlaceOrderInput,
): Promise<PlaceOrderResult> {
  const session = await _session();
  if (!session) return { ok: false, error: "not_authenticated" };

  let r: Response;
  try {
    r = await fetch(`${API_BASE}/api/v1/farmarket/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        delivery_region: input.delivery_region,
        delivery_notes: input.delivery_notes,
        items: input.items.map((i) => ({
          ad_id: i.ad_id,
          quantity_kg: String(i.quantity_kg),
        })),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { ok: false, error: "network_error" };
  }

  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { detail?: unknown };
    const detail =
      typeof body.detail === "string" ? body.detail : `request_failed:${r.status}`;
    return { ok: false, error: detail };
  }

  const order = (await r.json()) as Order;
  revalidatePath("/dashboard/restaurant/orders");
  return { ok: true, order };
}

export async function fetchMyOrders(): Promise<Order[]> {
  const session = await _session();
  if (!session) return [];

  let r: Response;
  try {
    r = await fetch(`${API_BASE}/api/v1/farmarket/orders/me`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return [];
  }
  if (!r.ok) return [];
  return (await r.json()) as Order[];
}

export async function fetchOrderById(orderId: string): Promise<Order | null> {
  const all = await fetchMyOrders();
  return all.find((o) => o.id === orderId) ?? null;
}

export async function cancelOrder(
  orderId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await _session();
  if (!session) return { ok: false, error: "not_authenticated" };

  let r: Response;
  try {
    r = await fetch(`${API_BASE}/api/v1/farmarket/orders/${orderId}/cancel`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, error: "network_error" };
  }

  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { detail?: unknown };
    const detail =
      typeof body.detail === "string" ? body.detail : `request_failed:${r.status}`;
    return { ok: false, error: detail };
  }

  revalidatePath("/dashboard/restaurant/orders");
  revalidatePath(`/dashboard/restaurant/orders/${orderId}`);
  return { ok: true };
}
