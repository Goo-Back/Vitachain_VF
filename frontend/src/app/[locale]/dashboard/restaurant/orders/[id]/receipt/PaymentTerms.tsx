"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { toIntlLocale } from "@/lib/intlLocale";
import type {
  PaymentMethod,
  PaymentStatus,
} from "@/app/[locale]/dashboard/restaurant/orders/actions";
import {
  PAYMENT_PARTNER,
  readPaymentChoice,
  type PaymentInstrument,
} from "@/lib/payment";

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
  const t = useTranslations("restaurant.orders.paymentTerms");
  const intlLocale = toIntlLocale(useLocale());
  const INSTRUMENT_LABEL: Record<PaymentInstrument, string> = {
    cash: t("instrumentCash"),
    check: t("instrumentCheck"),
  };
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

  const instrumentLabel = instrument ? INSTRUMENT_LABEL[instrument] : t("defaultInstrument");

  if (paymentMethod === "COD") {
    if (isPaid) {
      return (
        <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-4 text-xs text-emerald-900">
          <p className="font-semibold uppercase tracking-wider">
            {t("codPaidTitle")}
          </p>
          <p className="mt-1 text-sm font-bold text-neutral-900">
            {paidAt
              ? t("codPaidAmountWithDate", { amount: amount.toFixed(2), date: new Date(paidAt).toLocaleString(intlLocale) })
              : t("codPaidAmount", { amount: amount.toFixed(2) })}
          </p>
          <p className="mt-1">
            {t("codPaidBody", { instrument: instrumentLabel })}
          </p>
        </div>
      );
    }
    return (
      <div className="rounded-md border-2 border-dashed border-amber-300 bg-amber-50/60 p-4 text-xs text-amber-900">
        <p className="font-semibold uppercase tracking-wider">
          {t("codDueTitle")}
        </p>
        <p className="mt-1 text-sm font-bold text-neutral-900">
          {t("codDueAmount", { amount: amount.toFixed(2) })}
        </p>
        <p className="mt-1">
          {t("codDueBody", { instrument: instrumentLabel })}
        </p>
      </div>
    );
  }

  // PSP_TRANSFER
  if (isPaid) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-4 text-xs text-emerald-900">
        <p className="font-semibold uppercase tracking-wider">
          {t("pspPaidTitle")}
        </p>
        <p className="mt-1 text-sm font-bold text-neutral-900">
          {paidAt
            ? t("pspPaidAmountWithDate", {
                amount: amount.toFixed(2),
                partner: PAYMENT_PARTNER.name,
                date: new Date(paidAt).toLocaleString(intlLocale),
              })
            : t("pspPaidAmount", { amount: amount.toFixed(2), partner: PAYMENT_PARTNER.name })}
        </p>
        <p className="mt-1">
          {t("pspPaidBody")}
        </p>
      </div>
    );
  }

  if (paymentStatus === "FAILED") {
    return (
      <div className="rounded-md border-2 border-dashed border-red-300 bg-red-50/60 p-4 text-xs text-red-900">
        <p className="font-semibold uppercase tracking-wider">
          {t("pspFailedTitle")}
        </p>
        <p className="mt-1 text-sm font-bold text-neutral-900">
          {t("pspFailedAmount", { amount: amount.toFixed(2), partner: PAYMENT_PARTNER.name })}
        </p>
        <p className="mt-1">
          {t("pspFailedBody")}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border-2 border-dashed border-blue-300 bg-blue-50/60 p-4 text-xs text-blue-900">
      <p className="font-semibold uppercase tracking-wider">
        {t("pspPendingTitle")}
      </p>
      <p className="mt-1 text-sm font-bold text-neutral-900">
        {t("pspPendingAmount", { amount: amount.toFixed(2), partner: PAYMENT_PARTNER.name })}
      </p>
      <p className="mt-1">
        {t("pspPendingBody")}
      </p>
    </div>
  );
}
