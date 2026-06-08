"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  CheckCircleIcon,
  ClockIcon,
} from "@/app/dashboard/farmer/_ui/Icon";
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
  cash: "Espèces",
  check: "Chèque",
};

type Props = {
  orderId: string;
  amount: number;
  /** From the server (migration 0043). Drives the banner state. */
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paidAt: string | null;
};

/**
 * Payment summary banner backed by the server-stored payment_method /
 * payment_status (migration 0043). The COD instrument (cash vs cheque) is
 * still UI-only — read from sessionStorage as a display courtesy.
 */
export function PaymentEcho({
  orderId,
  amount,
  paymentMethod,
  paymentStatus,
  paidAt,
}: Props) {
  const [instrument, setInstrument] = useState<PaymentInstrument | null>(null);
  // Mock-PSP success is held client-side until a real PayMaroc webhook ships.
  // For COD we trust the server-stored payment_status only.
  const [pspMockPaid, setPspMockPaid] = useState(false);

  useEffect(() => {
    const choice = readPaymentChoice(orderId);
    setInstrument(choice.instrument);
    setPspMockPaid(choice.status === "paid");
  }, [orderId]);

  // Treat the legacy 'SIMULATED_PAID' value as PAID — pre-0043 rows used it
  // when the mock PSP was the only flow.
  const serverPaid =
    paymentStatus === "PAID" || paymentStatus === "SIMULATED_PAID";
  const isPaid =
    serverPaid || (paymentMethod === "PSP_TRANSFER" && pspMockPaid);

  if (paymentMethod === "COD") {
    if (isPaid) {
      return (
        <PaidBanner
          amount={amount}
          paidAt={paidAt}
          subtitle={`Réglé en ${instrument ? INSTRUMENT_LABEL[instrument].toLowerCase() : "espèces ou chèque"} au livreur VitaChain.`}
        />
      );
    }
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-amber-100">
            <ClockIcon size={18} className="text-amber-700" />
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-900">
              À régler à la livraison ·{" "}
              <span className="font-mono">{amount.toFixed(2)} MAD</span>
            </p>
            <p className="mt-1 text-xs text-amber-800">
              Mode : Paiement à la livraison
              {instrument ? ` (${INSTRUMENT_LABEL[instrument]})` : ""}. Préparez
              si possible l&apos;appoint. Un reçu signé vous sera remis par le
              livreur VitaChain à la réception.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // PSP_TRANSFER
  if (isPaid) {
    return (
      <PaidBanner
        amount={amount}
        paidAt={paidAt}
        subtitle={`Réglé via ${PAYMENT_PARTNER.name} (carte bancaire ou virement instantané).`}
      />
    );
  }

  if (paymentStatus === "FAILED") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-red-100">
            <ClockIcon size={18} className="text-red-700" />
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-900">
              Paiement échoué · {amount.toFixed(2)} MAD
            </p>
            <p className="mt-1 text-xs text-red-800">
              Votre dernier paiement {PAYMENT_PARTNER.name} n&apos;a pas
              abouti. Réessayez pour libérer la commande.
            </p>
            <Link
              href={`/dashboard/restaurant/orders/${orderId}/pay`}
              className="mt-3 inline-block rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800"
            >
              Réessayer le paiement
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // psp_transfer + due — payment was abandoned, allow resume
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-100">
          <ClockIcon size={18} className="text-blue-700" />
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-blue-900">
            Paiement en attente · {amount.toFixed(2)} MAD
          </p>
          <p className="mt-1 text-xs text-blue-800">
            Vous avez choisi de payer via {PAYMENT_PARTNER.name}. Reprenez le
            paiement pour que VitaChain transmette votre commande aux
            producteurs.
          </p>
          <Link
            href={`/dashboard/restaurant/orders/${orderId}/pay`}
            className="mt-3 inline-block rounded-md bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800"
          >
            Reprendre le paiement
          </Link>
        </div>
      </div>
    </div>
  );
}

function PaidBanner({
  amount,
  paidAt,
  subtitle,
}: {
  amount: number;
  paidAt: string | null;
  subtitle: string;
}) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-100">
          <CheckCircleIcon size={18} className="text-emerald-700" />
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-emerald-900">
            Paiement reçu · {amount.toFixed(2)} MAD
            {paidAt ? (
              <span className="ml-1 font-normal text-emerald-800">
                · {new Date(paidAt).toLocaleString("fr-MA")}
              </span>
            ) : null}
          </p>
          <p className="mt-1 text-xs text-emerald-800">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}
