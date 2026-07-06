"use server";

import { revalidatePath } from "next/cache";

import { authedApiFetch } from "@/lib/api/authed-fetch";

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

export async function fetchIncomingItems(): Promise<IncomingItem[]> {
  let r: Response;
  try {
    r = await authedApiFetch("/farmarket/orders/incoming", {
      timeoutMs: 10_000,
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
  let r: Response;
  try {
    r = await authedApiFetch(
      `/farmarket/orders/items/${itemId}/status`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          new_status: input.new_status,
          producer_note: input.producer_note ?? null,
        }),
        timeoutMs: 10_000,
      },
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

  revalidatePath("/dashboard/farmer/orders");
  return { ok: true };
}
