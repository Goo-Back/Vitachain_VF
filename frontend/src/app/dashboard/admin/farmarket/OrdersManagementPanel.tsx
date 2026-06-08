"use client";

import { Fragment, useMemo, useState } from "react";

import type { AdminOrderListItem, OrderStatus } from "./types";
import {
  ADMIN_ORDER_TRANSITIONS,
  ORDER_STATUS_COLORS,
  ORDER_STATUS_LABELS,
  TRANSITION_ACTION_LABELS,
  shortRef,
} from "./orderStatus";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Props = {
  initial: AdminOrderListItem[];
  accessToken: string;
};

const FILTERS: Array<{ value: "ALL" | OrderStatus; label: string }> = [
  { value: "ALL", label: "Toutes" },
  { value: "PENDING", label: "En attente" },
  { value: "ACCEPTED", label: "Confirmées" },
  { value: "IN_PROGRESS", label: "Expédiées" },
  { value: "DELIVERED", label: "Livrées" },
  { value: "CANCELLED", label: "Annulées" },
  { value: "RETURNED", label: "Retournées" },
];

export function OrdersManagementPanel({ initial, accessToken }: Props) {
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
        setError(formatError(body.detail ?? `request_failed:${res.status}`));
        return;
      }
      const updated = (await res.json()) as AdminOrderListItem;
      setOrders((prev) =>
        prev.map((o) => (o.id === order.id ? { ...o, ...updated } : o)),
      );
    } catch {
      setError("Erreur réseau. Réessayez.");
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
                  "Référence",
                  "Client",
                  "Téléphone",
                  "Ville / Région",
                  "Montant",
                  "Paiement",
                  "Statut",
                  "Actions",
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
                    Aucune commande dans ce filtre.
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
                          {new Date(o.created_at).toLocaleString("fr-MA")}
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
                          {o.payment_method === "COD" ? "COD" : "Virement"}
                        </span>
                        <span
                          className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
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
                          {ORDER_STATUS_LABELS[o.status]}
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
                                ? "…"
                                : TRANSITION_ACTION_LABELS[next]}
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
                                Adresse :
                              </span>{" "}
                              {o.delivery_address ?? "—"}, {o.delivery_city ?? "—"}{" "}
                              ({o.delivery_region})
                            </p>
                            <p>
                              <span className="font-semibold text-neutral-800">
                                Restaurant (UUID) :
                              </span>{" "}
                              <span className="font-mono">
                                {o.restaurant_id.slice(0, 8)}…
                              </span>
                            </p>
                            <p>
                              <span className="font-semibold text-neutral-800">
                                Sous-total / logistique :
                              </span>{" "}
                              {Number(o.subtotal_mad).toFixed(2)} +{" "}
                              {Number(o.logistics_fee_mad).toFixed(2)} MAD
                            </p>
                            <p>
                              <span className="font-semibold text-neutral-800">
                                Notes de livraison :
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

function formatError(code: string): string {
  if (code.startsWith("invalid_transition"))
    return "Transition de statut non autorisée pour cette commande.";
  if (code.startsWith("already_"))
    return "La commande est déjà dans ce statut.";
  if (code === "order_not_found") return "Commande introuvable.";
  if (code === "order_status_update_failed")
    return "La mise à jour a échoué côté base. Réessayez.";
  return `Erreur (${code}).`;
}
