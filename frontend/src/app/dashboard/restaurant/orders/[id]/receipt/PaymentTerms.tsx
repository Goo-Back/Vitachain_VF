"use client";

import { useEffect, useState } from "react";

import type {
  PaymentMethod,
  PaymentStatus,
} from "@/app/dashboard/restaurant/orders/actions";
import {
  PAYMENT_PARTNER,
  readPaymentChoice,
  type PaymentInstrument,
} from "@/lib/payment";

const INSTRUMENT_LABEL: Record<PaymentInstrument, string> = {
  cash: "espèces",
  check: "chèque libellé à l'ordre de VitaChain",
};

type Props = {
  orderId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paidAt: string | null;
};

/**
 * Print-safe payment-terms block driven by server-stored payment_method /
 * payment_status (migration 0043). The COD instrument is still UI-only so it
 * comes from sessionStorage as a courtesy detail.
 */
export function PaymentTerms({
  orderId,
  amount,
  paymentMethod,
  paymentStatus,
  paidAt,
}: Props) {
  const [instrument, setInstrument] = useState<PaymentInstrument | null>(null);
  const [pspMockPaid, setPspMockPaid] = useState(false);

  useEffect(() => {
    const choice = readPaymentChoice(orderId);
    setInstrument(choice.instrument);
    setPspMockPaid(choice.status === "paid");
  }, [orderId]);

  const serverPaid =
    paymentStatus === "PAID" || paymentStatus === "SIMULATED_PAID";
  const isPaid =
    serverPaid || (paymentMethod === "PSP_TRANSFER" && pspMockPaid);

  if (paymentMethod === "COD") {
    if (isPaid) {
      return (
        <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-4 text-xs text-emerald-900">
          <p className="font-semibold uppercase tracking-wider">
            Paiement reçu — Paiement à la livraison
          </p>
          <p className="mt-1 text-sm font-bold text-neutral-900">
            {amount.toFixed(2)} MAD encaissés
            {paidAt
              ? ` le ${new Date(paidAt).toLocaleString("fr-MA")}`
              : ""}
          </p>
          <p className="mt-1">
            Règlement par {instrument ? INSTRUMENT_LABEL[instrument] : "espèces ou chèque"}{" "}
            remis au livreur VitaChain. Reçu signé délivré à la réception.
          </p>
        </div>
      );
    }
    return (
      <div className="rounded-md border-2 border-dashed border-amber-300 bg-amber-50/60 p-4 text-xs text-amber-900">
        <p className="font-semibold uppercase tracking-wider">
          Paiement à la livraison
        </p>
        <p className="mt-1 text-sm font-bold text-neutral-900">
          Montant dû au livreur · {amount.toFixed(2)} MAD
        </p>
        <p className="mt-1">
          Règlement par {instrument ? INSTRUMENT_LABEL[instrument] : "espèces ou chèque"}.
          Le livreur remet un reçu signé à la réception. Aucune somme n&apos;est
          due au producteur en main propre.
        </p>
      </div>
    );
  }

  // PSP_TRANSFER
  if (isPaid) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-4 text-xs text-emerald-900">
        <p className="font-semibold uppercase tracking-wider">
          Paiement reçu
        </p>
        <p className="mt-1 text-sm font-bold text-neutral-900">
          {amount.toFixed(2)} MAD réglés via {PAYMENT_PARTNER.name}
          {paidAt
            ? ` le ${new Date(paidAt).toLocaleString("fr-MA")}`
            : ""}
        </p>
        <p className="mt-1">
          Transaction sécurisée 3-D Secure. La facture acquittée est jointe à
          ce bon de commande.
        </p>
      </div>
    );
  }

  if (paymentStatus === "FAILED") {
    return (
      <div className="rounded-md border-2 border-dashed border-red-300 bg-red-50/60 p-4 text-xs text-red-900">
        <p className="font-semibold uppercase tracking-wider">
          Paiement échoué
        </p>
        <p className="mt-1 text-sm font-bold text-neutral-900">
          {amount.toFixed(2)} MAD à régler via {PAYMENT_PARTNER.name}
        </p>
        <p className="mt-1">
          Réessayez depuis votre tableau de bord. La commande reste suspendue
          jusqu&apos;à confirmation du paiement.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border-2 border-dashed border-blue-300 bg-blue-50/60 p-4 text-xs text-blue-900">
      <p className="font-semibold uppercase tracking-wider">
        Paiement en attente
      </p>
      <p className="mt-1 text-sm font-bold text-neutral-900">
        {amount.toFixed(2)} MAD à régler via {PAYMENT_PARTNER.name}
      </p>
      <p className="mt-1">
        Reprenez le paiement depuis votre tableau de bord — la commande ne
        sera transmise aux producteurs qu&apos;une fois le règlement confirmé.
      </p>
    </div>
  );
}
