"use client";

import { useLocale, useTranslations } from "next-intl";
import { Fragment, useMemo, useState } from "react";

import { toIntlLocale } from "@/lib/intlLocale";

import type { AdminOrderListItem, OrderStatus } from "./types";
import {
  ADMIN_ORDER_TRANSITIONS,
  ORDER_STATUS_COLORS,
  getOrderStatusLabel,
  getTransitionActionLabel,
  shortRef,
} from "./orderStatus";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Props = {
  initial: AdminOrderListItem[];
  accessToken: string;
};

export function OrdersManagementPanel({ initial, accessToken }: Props) {
  const t = useTranslations("admin.farmarket.ordersManagement");
  const tStatus = useTranslations("admin.farmarket.orderStatus");
  const intlLocale = toIntlLocale(useLocale());

  const FILTERS: Array<{ value: "ALL" | OrderStatus; label: string }> = [
    { value: "ALL", label: t("filters.all") },
    { value: "PENDING", label: t("filters.PENDING") },
    { value: "ACCEPTED", label: t("filters.ACCEPTED") },
    { value: "IN_PROGRESS", label: t("filters.IN_PROGRESS") },
    { value: "DELIVERED", label: t("filters.DELIVERED") },
    { value: "CANCELLED", label: t("filters.CANCELLED") },
    { value: "RETURNED", label: t("filters.RETURNED") },
  ];

  const [orders, setOrders] = useState<AdminOrderListItem[]>(initial);
  const [filter, setFilter] = useState<"ALL" | OrderStatus>("ALL");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      filter === "ALL"
        ? orders
        : orders.filter((o) => o.status === filter),
    [orders, filter],
  );

  async function changeStatus(order: AdminOrderListItem, next: OrderStatus) {
    setBusyId(order.id);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/admin/farmarket/orders/${order.id}/status`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ new_status: next }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          detail?: string;
        };
        setError(formatError(body.detail ?? `request_failed:${res.status}`, t));
        return;
      }
      const updated = (await res.json()) as AdminOrderListItem;
      setOrders((prev) =>
        prev.map((o) => (o.id === order.id ? { ...o, ...updated } : o)),
      );
    } catch {
      setError(t("networkError"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              filter === f.value
                ? "bg-leaf-600 text-white"
                : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <thead className="bg-neutral-50">
              <tr>
                {[
                  t("table.reference"),
                  t("table.client"),
                  t("table.phone"),
                  t("table.cityRegion"),
                  t("table.amount"),
                  t("table.payment"),
                  t("table.status"),
                  t("table.actions"),
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-neutral-400"
                  >
                    {t("empty")}
                  </td>
                </tr>
              )}
              {filtered.map((o) => {
                const transitions = ADMIN_ORDER_TRANSITIONS[o.status] ?? [];
                const isOpen = expanded === o.id;
                return (
                  <Fragment key={o.id}>
                    <tr className="hover:bg-neutral-50">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : o.id)}
                          className="font-mono text-xs font-semibold text-leaf-700 hover:underline"
                        >
                          {shortRef(o.id)}
                        </button>
                        <p className="text-[10px] text-neutral-400">
                          {new Date(o.created_at).toLocaleString(intlLocale)}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-neutral-700">
                        {o.delivery_contact_name ?? (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-neutral-600">
                        {o.delivery_phone ? (
                          <a
                            href={`tel:${o.delivery_phone}`}
                            className="hover:underline"
                          >
                            {o.delivery_phone}
                          </a>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-neutral-600">
                        <div>{o.delivery_city ?? "—"}</div>
                        <div className="text-xs text-neutral-400">
                          {o.delivery_region}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-semibold text-neutral-900">
                        {Number(o.total_mad).toFixed(2)} MAD
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-neutral-600">
                          {o.payment_method === "COD" ? "COD" : t("paymentBankTransfer")}
                        </span>
                        <span
                          className={`ms-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                            o.payment_status === "PAID"
                              ? "bg-emerald-100 text-emerald-800"
                              : o.payment_status === "FAILED"
                                ? "bg-red-100 text-red-700"
                                : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {o.payment_status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ORDER_STATUS_COLORS[o.status]}`}
                        >
                          {getOrderStatusLabel(o.status, tStatus)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {transitions.length === 0 && (
                            <span className="text-xs text-neutral-400">—</span>
                          )}
                          {transitions.map((next) => (
                            <button
                              key={next}
                              type="button"
                              disabled={busyId === o.id}
                              onClick={() => changeStatus(o, next)}
                              className={`rounded px-2.5 py-1 text-xs font-medium transition disabled:cursor-wait disabled:opacity-60 ${
                                next === "CANCELLED" || next === "RETURNED"
                                  ? "bg-red-100 text-red-700 hover:bg-red-200"
                                  : "bg-leaf-600 text-white hover:bg-leaf-700"
                              }`}
                            >
                              {busyId === o.id
                                ? t("busy")
                                : getTransitionActionLabel(next, tStatus)}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-neutral-50/60">
                        <td colSpan={8} className="px-4 py-3">
                          <div className="grid gap-2 text-xs text-neutral-600 sm:grid-cols-2">
                            <p>
                              <span className="font-semibold text-neutral-800">
                                {t("expanded.address")}
                              </span>{" "}
                              {o.delivery_address ?? "—"}, {o.delivery_city ?? "—"}{" "}
                              ({o.delivery_region})
                            </p>
                            <p>
                              <span className="font-semibold text-neutral-800">
                                {t("expanded.restaurantId")}
                              </span>{" "}
                              <span className="font-mono">
                                {o.restaurant_id.slice(0, 8)}…
                              </span>
                            </p>
                            <p>
                              <span className="font-semibold text-neutral-800">
                                {t("expanded.subtotalLogistics")}
                              </span>{" "}
                              {Number(o.subtotal_mad).toFixed(2)} +{" "}
                              {Number(o.logistics_fee_mad).toFixed(2)} MAD
                            </p>
                            <p>
                              <span className="font-semibold text-neutral-800">
                                {t("expanded.deliveryNotes")}
                              </span>{" "}
                              {o.delivery_notes ?? "—"}
                            </p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function formatError(
  code: string,
  t: ReturnType<typeof useTranslations>,
): string {
  if (code.startsWith("invalid_transition"))
    return t("errors.invalidTransition");
  if (code.startsWith("already_"))
    return t("errors.alreadyStatus");
  if (code === "order_not_found") return t("errors.orderNotFound");
  if (code === "order_status_update_failed")
    return t("errors.updateFailed");
  return t("errors.fallback", { code });
}
