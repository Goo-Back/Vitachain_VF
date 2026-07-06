"use server";

import { revalidatePath } from "next/cache";

import { authedApiFetch } from "@/lib/api/authed-fetch";

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

export type PaymentMethod = "COD" | "PSP_TRANSFER";
export type PaymentStatus =
  | "DUE"
  | "PAID"
  | "FAILED"
  | "SIMULATED_PAID"
  | "PENDING";

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
    | "CANCELLED"
    | "RETURNED";
  delivery_region: string;
  delivery_notes: string | null;
  delivery_contact_name: string | null;
  delivery_phone: string | null;
  delivery_address: string | null;
  delivery_city: string | null;
  subtotal_mad: string;
  logistics_fee_mad: string;
  total_mad: string;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  paid_at: string | null;
  items: OrderItem[];
  created_at: string;
  updated_at: string;
};

export type PlaceOrderInput = {
  delivery_region: string;
  delivery_notes: string | null;
  delivery_contact_name: string;
  delivery_phone: string;
  delivery_address: string;
  delivery_city: string;
  payment_method: PaymentMethod;
  items: { ad_id: string; quantity_kg: number }[];
};

export type PlaceOrderResult =
  | { ok: true; order: Order }
  | { ok: false; error: string };

export async function placeOrder(
  input: PlaceOrderInput,
): Promise<PlaceOrderResult> {
  let r: Response;
  try {
    r = await authedApiFetch("/farmarket/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        delivery_region: input.delivery_region,
        delivery_notes: input.delivery_notes,
        delivery_contact_name: input.delivery_contact_name,
        delivery_phone: input.delivery_phone,
        delivery_address: input.delivery_address,
        delivery_city: input.delivery_city,
        payment_method: input.payment_method,
        items: input.items.map((i) => ({
          ad_id: i.ad_id,
          quantity_kg: String(i.quantity_kg),
        })),
      }),
      timeoutMs: 20_000,
    });
  } catch (e) {
    return {
      ok: false,
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
    return { ok: false, error: detail };
  }

  const order = (await r.json()) as Order;
  revalidatePath("/dashboard/restaurant/orders");
  return { ok: true, order };
}

export async function fetchMyOrders(): Promise<Order[]> {
  let r: Response;
  try {
    r = await authedApiFetch("/farmarket/orders/me", { timeoutMs: 10_000 });
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

export async function confirmPayment(
  orderId: string,
): Promise<{ ok: boolean; order?: Order; error?: string }> {
  let r: Response;
  try {
    r = await authedApiFetch(
      `/farmarket/orders/${orderId}/confirm-payment`,
      { method: "PATCH", timeoutMs: 10_000 },
    );
  } catch (e) {
    return {
      ok: false,
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
    return { ok: false, error: detail };
  }

  const order = (await r.json()) as Order;
  revalidatePath("/dashboard/restaurant/orders");
  revalidatePath(`/dashboard/restaurant/orders/${orderId}`);
  return { ok: true, order };
}

export async function cancelOrder(
  orderId: string,
): Promise<{ ok: boolean; error?: string }> {
  let r: Response;
  try {
    r = await authedApiFetch(`/farmarket/orders/${orderId}/cancel`, {
      method: "PATCH",
      timeoutMs: 10_000,
    });
  } catch (e) {
    return {
      ok: false,
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
    return { ok: false, error: detail };
  }

  revalidatePath("/dashboard/restaurant/orders");
  revalidatePath(`/dashboard/restaurant/orders/${orderId}`);
  return { ok: true };
}
