import type { useTranslations } from "next-intl";

import type { OrderStatus } from "./types";

/** Matches next-intl's useTranslations return type (works for useTranslations or getTranslations results). */
type Translator = ReturnType<typeof useTranslations>;

/** Localized label for the order header status pipeline. */
export function getOrderStatusLabel(status: OrderStatus, t: Translator): string {
  return t(`status.${status}`);
}

/** Tailwind badge classes per status. */
export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  PARTIALLY_ACCEPTED: "bg-sky-100 text-sky-800",
  ACCEPTED: "bg-blue-100 text-blue-800",
  REJECTED: "bg-red-100 text-red-700",
  IN_PROGRESS: "bg-indigo-100 text-indigo-800",
  DELIVERED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-neutral-200 text-neutral-700",
  RETURNED: "bg-orange-100 text-orange-800",
};

/**
 * Allowed coarse admin transitions — MUST mirror _ADMIN_ORDER_TRANSITIONS in
 * backend/app/routers/admin/farmarket.py. The dashboard derives its action
 * buttons from this map.
 */
export const ADMIN_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["ACCEPTED", "CANCELLED"],
  PARTIALLY_ACCEPTED: ["ACCEPTED", "IN_PROGRESS", "CANCELLED"],
  ACCEPTED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["DELIVERED", "CANCELLED"],
  DELIVERED: ["RETURNED"],
  REJECTED: [],
  CANCELLED: [],
  RETURNED: [],
};

/** Short, localized action verb shown on the transition button. */
export function getTransitionActionLabel(status: OrderStatus, t: Translator): string {
  return t(`transitionAction.${status}`);
}

export function shortRef(orderId: string): string {
  return `VITA-${orderId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}
