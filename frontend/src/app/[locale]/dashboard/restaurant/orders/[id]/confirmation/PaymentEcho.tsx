"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useEffect, useState } from "react";

import { toIntlLocale } from "@/lib/intlLocale";
import {
  CheckCircleIcon,
  ClockIcon,
} from "@/app/[locale]/dashboard/farmer/_ui/Icon";
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
  const t = useTranslations("restaurant.orders.paymentEcho");
  const INSTRUMENT_LABEL: Record<PaymentInstrument, string> = {
    cash: t("instrumentCash"),
    check: t("instrumentCheck"),
  };
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
          subtitle={t("codPaidSubtitle", {
            instrument: instrument
              ? INSTRUMENT_LABEL[instrument].toLowerCase()
              : t("defaultInstrument"),
          })}
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
              {t("codDueTitle")}{" "}
              <span className="font-mono">{amount.toFixed(2)} MAD</span>
            </p>
            <p className="mt-1 text-xs text-amber-800">
              {instrument
                ? t("codDueModeWithInstrument", { instrument: INSTRUMENT_LABEL[instrument] })
                : t("codDueMode")}
              . {t("codDueBody")}
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
        subtitle={t("pspPaidSubtitle", { partner: PAYMENT_PARTNER.name })}
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
              {t("pspFailedTitle")} {amount.toFixed(2)} MAD
            </p>
            <p className="mt-1 text-xs text-red-800">
              {t("pspFailedBody", { partner: PAYMENT_PARTNER.name })}
            </p>
            <Link
              href={`/dashboard/restaurant/orders/${orderId}/pay`}
              className="mt-3 inline-block rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800"
            >
              {t("retryPayment")}
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
            {t("pspPendingTitle")} {amount.toFixed(2)} MAD
          </p>
          <p className="mt-1 text-xs text-blue-800">
            {t("pspPendingBody", { partner: PAYMENT_PARTNER.name })}
          </p>
          <Link
            href={`/dashboard/restaurant/orders/${orderId}/pay`}
            className="mt-3 inline-block rounded-md bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800"
          >
            {t("resumePayment")}
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
  const t = useTranslations("restaurant.orders.paymentEcho");
  const intlLocale = toIntlLocale(useLocale());
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-100">
          <CheckCircleIcon size={18} className="text-emerald-700" />
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-emerald-900">
            {t("paidBannerTitle")} {amount.toFixed(2)} MAD
            {paidAt ? (
              <span className="ms-1 font-normal text-emerald-800">
                · {new Date(paidAt).toLocaleString(intlLocale)}
              </span>
            ) : null}
          </p>
          <p className="mt-1 text-xs text-emerald-800">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}
