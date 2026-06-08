"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { CheckCircleIcon } from "@/app/dashboard/farmer/_ui/Icon";
import {
  confirmPayment,
  type PaymentMethod,
  type PaymentStatus,
} from "@/app/dashboard/restaurant/orders/actions";

const RECEIPT_ACK_KEY = (orderId: string) =>
  `vita_order_received_${orderId}`;

type Props = {
  orderId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
};

/**
 * Two affordances rolled into one:
 *
 *   1. Reception acknowledgement (restaurant confirms the goods arrived
 *      conforming). Persisted client-side until a server-side reception
 *      endpoint ships — the ack is mostly a journaling convenience for the
 *      restaurant.
 *   2. COD payment confirmation. Calls PATCH /orders/{id}/confirm-payment
 *      so the order's payment_status flips DUE → PAID in the database.
 *
 * For PSP orders the payment is settled before fulfilment, so the button is
 * a pure reception ack — no API call to confirm-payment.
 */
export function ConfirmReceptionButton({
  orderId,
  amount,
  paymentMethod,
  paymentStatus,
}: Props) {
  const router = useRouter();
  const key = RECEIPT_ACK_KEY(orderId);
  const [receivedAt, setReceivedAt] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(key);
      if (v) setReceivedAt(v);
    } catch {
      // ignore
    }
  }, [key]);

  const codPaid = paymentMethod === "COD" && paymentStatus === "PAID";
  const codDue = paymentMethod === "COD" && paymentStatus === "DUE";

  function handleConfirm() {
    setError(null);
    const now = new Date().toISOString();

    if (codDue) {
      startTransition(async () => {
        const result = await confirmPayment(orderId);
        if (!result.ok) {
          setError(formatError(result.error ?? "unknown"));
          return;
        }
        try {
          window.localStorage.setItem(key, now);
        } catch {
          // ignore
        }
        setReceivedAt(now);
        router.refresh();
      });
      return;
    }

    // PSP order or COD already paid (e.g. admin reconciled) → just log ack.
    try {
      window.localStorage.setItem(key, now);
    } catch {
      // ignore
    }
    setReceivedAt(now);
  }

  // Already done.
  if (receivedAt || codPaid) {
    const ts = receivedAt ?? new Date().toISOString();
    return (
      <div className="flex items-start gap-2 rounded-lg bg-leaf-50 p-3 text-sm text-leaf-800 ring-1 ring-leaf-200">
        <CheckCircleIcon size={16} className="mt-0.5 text-leaf-700" />
        <div>
          <p className="font-medium">
            {codPaid && !receivedAt
              ? "Paiement enregistré"
              : "Réception confirmée"}
          </p>
          <p className="text-xs text-leaf-700">
            {new Date(ts).toLocaleString("fr-MA")}
            {codPaid
              ? ` — paiement de ${amount.toFixed(2)} MAD remis au livreur.`
              : "."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleConfirm}
        disabled={isPending}
        className="vc-btn-primary disabled:opacity-60"
      >
        <CheckCircleIcon size={14} />
        {isPending
          ? "Enregistrement…"
          : codDue
            ? `Confirmer la réception + paiement (${amount.toFixed(2)} MAD)`
            : "Confirmer la réception"}
      </button>
      {error && (
        <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
          {error}
        </p>
      )}
      <p className="mt-2 text-[11px] text-neutral-500">
        {codDue
          ? "Cliquez après avoir remis le règlement au livreur et vérifié la conformité — le paiement sera enregistré dans nos systèmes."
          : "Vous avez 24 h après la livraison pour signaler un défaut ou un manque."}
      </p>
    </div>
  );
}

function formatError(code: string): string {
  if (code === "not_cod_order")
    return "Cette commande n'est pas en paiement à la livraison.";
  if (code === "payment_already_settled")
    return "Paiement déjà enregistré sur cette commande.";
  if (code === "not_order_owner")
    return "Vous n'êtes pas le propriétaire de cette commande.";
  if (code === "order_not_found") return "Commande introuvable.";
  if (code === "not_authenticated") return "Session expirée. Reconnectez-vous.";
  return `Erreur (${code}).`;
}
