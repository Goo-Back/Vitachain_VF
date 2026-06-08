"use client";

import { useState } from "react";

import type { AdminOrderListItem, PaymentAuditRow } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Props = {
  initial: AdminOrderListItem[];
  accessToken: string;
};

type OverrideTarget = {
  order: AdminOrderListItem;
  new_status: "PAID" | "FAILED" | "DUE";
};

export function CodReconciliationPanel({ initial, accessToken }: Props) {
  const [orders, setOrders] = useState<AdminOrderListItem[]>(initial);
  const [auditFor, setAuditFor] = useState<AdminOrderListItem | null>(null);
  const [override, setOverride] = useState<OverrideTarget | null>(null);

  function handleOverridden(updated: AdminOrderListItem) {
    setOrders((prev) =>
      // If the row is no longer DUE (i.e. PAID or FAILED), remove it from the
      // outstanding queue. Otherwise update in place.
      updated.payment_status === "DUE"
        ? prev.map((o) => (o.id === updated.id ? updated : o))
        : prev.filter((o) => o.id !== updated.id),
    );
    setOverride(null);
  }

  const totalDueMad = orders.reduce(
    (acc, o) => acc + Number(o.total_mad),
    0,
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Commandes COD en attente"
          value={String(orders.length)}
          tone="amber"
        />
        <Stat
          label="Cash à réconcilier"
          value={`${totalDueMad.toFixed(0)} MAD`}
          tone="amber"
        />
        <Stat
          label="Plus ancienne (jours)"
          value={
            orders.length === 0
              ? "—"
              : Math.max(...orders.map((o) => o.age_days ?? 0)).toFixed(1)
          }
          tone={
            orders.length > 0 &&
            Math.max(...orders.map((o) => o.age_days ?? 0)) > 7
              ? "red"
              : "leaf"
          }
        />
      </div>

      <div className="rounded-lg border border-leaf-100 bg-leaf-50/40 p-3 text-xs text-leaf-800">
        <strong>Bonnes pratiques :</strong> ne marquez{" "}
        <code className="rounded bg-white px-1">PAID</code> qu&apos;après dépôt
        physique du cash en caisse. Tout override doit porter une raison
        explicite (réf. dépôt, n° d&apos;incident, etc.) — chaque transition
        est tracée dans le journal d&apos;audit.
      </div>

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <thead className="bg-neutral-50">
              <tr>
                {[
                  "Référence",
                  "Restaurant",
                  "Région",
                  "Montant",
                  "Âge",
                  "Statut commande",
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
              {orders.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-neutral-400"
                  >
                    Aucune commande COD en attente — caisse réconciliée.
                  </td>
                </tr>
              )}
              {orders.map((o) => {
                const ref = `VITA-${o.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
                const age = o.age_days ?? 0;
                const ageCls =
                  age > 7
                    ? "text-red-600 font-semibold"
                    : age > 2
                      ? "text-amber-600"
                      : "text-neutral-500";
                return (
                  <tr key={o.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs font-semibold text-neutral-900">
                        {ref}
                      </p>
                      <p className="text-[10px] text-neutral-400">
                        {new Date(o.created_at).toLocaleString("fr-MA")}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-neutral-600">
                      {o.restaurant_id.slice(0, 8)}…
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {o.delivery_region}
                    </td>
                    <td className="px-4 py-3 font-semibold text-neutral-900">
                      {Number(o.total_mad).toFixed(2)} MAD
                    </td>
                    <td className={`px-4 py-3 text-xs ${ageCls}`}>
                      {age.toFixed(1)} j
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
                        {o.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setOverride({ order: o, new_status: "PAID" })
                          }
                          className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                        >
                          Marquer PAID
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setOverride({ order: o, new_status: "FAILED" })
                          }
                          className="rounded bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-200"
                        >
                          FAILED
                        </button>
                        <button
                          type="button"
                          onClick={() => setAuditFor(o)}
                          className="rounded bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-200"
                        >
                          Audit
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {override && (
        <OverrideDialog
          target={override}
          accessToken={accessToken}
          onClose={() => setOverride(null)}
          onSaved={handleOverridden}
        />
      )}

      {auditFor && (
        <AuditDialog
          order={auditFor}
          accessToken={accessToken}
          onClose={() => setAuditFor(null)}
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "amber" | "leaf" | "red";
}) {
  const ring =
    tone === "amber"
      ? "ring-amber-100 bg-amber-50"
      : tone === "red"
        ? "ring-red-100 bg-red-50"
        : "ring-leaf-100 bg-leaf-50";
  return (
    <div className={`rounded-lg p-4 ring-1 ${ring}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className="mt-1 text-xl font-bold text-neutral-900">{value}</p>
    </div>
  );
}

function OverrideDialog({
  target,
  accessToken,
  onClose,
  onSaved,
}: {
  target: OverrideTarget;
  accessToken: string;
  onClose: () => void;
  onSaved: (updated: AdminOrderListItem) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPaid = target.new_status === "PAID";
  const isFailed = target.new_status === "FAILED";

  async function submit() {
    setError(null);
    if (reason.trim().length < 3) {
      setError("La raison doit faire au moins 3 caractères.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/admin/farmarket/orders/${target.order.id}/payment`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            new_status: target.new_status,
            reason: reason.trim(),
          }),
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
      onSaved({ ...target.order, ...updated });
    } catch {
      setError("Erreur réseau. Réessayez.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <h3 className="text-base font-semibold text-neutral-900">
        {isPaid && "Marquer la commande comme PAID"}
        {isFailed && "Marquer le paiement FAILED"}
        {!isPaid && !isFailed && "Réouvrir le paiement (DUE)"}
      </h3>
      <p className="mt-1 text-xs text-neutral-500">
        Référence : <span className="font-mono">{shortRef(target.order.id)}</span>{" "}
        · Montant :{" "}
        <span className="font-semibold">
          {Number(target.order.total_mad).toFixed(2)} MAD
        </span>
      </p>

      <label htmlFor="reason" className="mt-4 block text-xs font-medium text-neutral-700">
        Raison (obligatoire — sera tracée dans le journal d&apos;audit)
      </label>
      <textarea
        id="reason"
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={
          isPaid
            ? "Ex. Cash déposé en caisse le 28/05/2026 — bordereau #BD-2026-152."
            : isFailed
              ? "Ex. Chargeback PSP, ref TXN-9921. Commande remboursée."
              : "Ex. Annulation paiement suite à demande restaurant — ticket #438."
        }
        className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
        maxLength={500}
      />

      {error && (
        <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60 ${
            isPaid
              ? "bg-emerald-600 hover:bg-emerald-700"
              : isFailed
                ? "bg-red-600 hover:bg-red-700"
                : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {busy ? "Enregistrement…" : "Confirmer"}
        </button>
      </div>
    </Modal>
  );
}

function AuditDialog({
  order,
  accessToken,
  onClose,
}: {
  order: AdminOrderListItem;
  accessToken: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<PaymentAuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (rows === null && error === null) {
    void (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/v1/admin/farmarket/orders/${order.id}/payment-audit`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: "no-store",
          },
        );
        if (!res.ok) {
          setError(`Erreur HTTP ${res.status}`);
          setRows([]);
          return;
        }
        const body = (await res.json()) as { items: PaymentAuditRow[] };
        setRows(body.items);
      } catch {
        setError("Erreur réseau");
        setRows([]);
      }
    })();
  }

  return (
    <Modal onClose={onClose}>
      <h3 className="text-base font-semibold text-neutral-900">
        Journal d&apos;audit · {shortRef(order.id)}
      </h3>
      <p className="mt-1 text-xs text-neutral-500">
        Toutes les transitions de payment_status sur cette commande.
      </p>

      {error && (
        <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {rows && rows.length === 0 && !error && (
        <p className="mt-4 rounded bg-neutral-50 px-3 py-3 text-sm text-neutral-500">
          Aucune transition tracée pour cette commande.
        </p>
      )}

      {rows && rows.length > 0 && (
        <ul className="mt-4 max-h-96 space-y-3 overflow-y-auto pr-1">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border border-neutral-200 bg-white p-3 text-sm"
            >
              <div className="flex items-center justify-between">
                <p className="font-medium text-neutral-900">
                  {r.previous_status} → {r.new_status}
                </p>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    r.actor_role === "ADMIN"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-leaf-100 text-leaf-800"
                  }`}
                >
                  {r.actor_role}
                </span>
              </div>
              <p className="mt-1 text-xs text-neutral-500">
                {new Date(r.created_at).toLocaleString("fr-MA")} · acteur{" "}
                <span className="font-mono">{r.actor_id.slice(0, 8)}…</span>
              </p>
              <p className="mt-2 rounded bg-neutral-50 px-2 py-1.5 text-xs italic text-neutral-700">
                « {r.reason} »
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          Fermer
        </button>
      </div>
    </Modal>
  );
}

function Modal({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-neutral-900/40"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-lg bg-white p-6 shadow-lifted">
        {children}
      </div>
    </div>
  );
}

function shortRef(orderId: string): string {
  return `VITA-${orderId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function formatError(code: string): string {
  if (code.startsWith("payment_already_"))
    return "Le statut demandé est déjà le statut actuel.";
  if (code === "order_not_found") return "Commande introuvable.";
  if (code === "payment_override_failed")
    return "L'override a échoué côté base. Vérifiez les permissions.";
  if (code === "payment_audit_insert_failed")
    return "Audit non écrit — l'override a été annulé. Réessayez.";
  return `Erreur (${code}).`;
}
