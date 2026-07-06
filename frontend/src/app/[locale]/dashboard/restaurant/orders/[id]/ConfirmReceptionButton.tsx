"use client";

import { useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

import { toIntlLocale } from "@/lib/intlLocale";
import { CheckCircleIcon } from "@/app/[locale]/dashboard/farmer/_ui/Icon";
import {
  confirmPayment,
  type PaymentMethod,
  type PaymentStatus,
} from "@/app/[locale]/dashboard/restaurant/orders/actions";

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
  const t = useTranslations("restaurant.orders.confirmReception");
  const intlLocale = toIntlLocale(useLocale());
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

  function formatError(code: string): string {
    if (code === "not_cod_order") return t("notCodOrderError");
    if (code === "payment_already_settled") return t("alreadySettledError");
    if (code === "not_order_owner") return t("notOwnerError");
    if (code === "order_not_found") return t("orderNotFoundError");
    if (code === "not_authenticated") return t("sessionExpiredError");
    return t("genericError", { code });
  }

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
              ? t("paymentRegistered")
              : t("receptionConfirmed")}
          </p>
          <p className="text-xs text-leaf-700">
            {new Date(ts).toLocaleString(intlLocale)}
            {codPaid
              ? t("paidToDeliverer", { amount: amount.toFixed(2) })
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
          ? t("registering")
          : codDue
            ? t("confirmReceptionPayment", { amount: amount.toFixed(2) })
            : t("confirmReceptionOnly")}
      </button>
      {error && (
        <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
          {error}
        </p>
      )}
      <p className="mt-2 text-[11px] text-neutral-500">
        {codDue ? t("hintCod") : t("hintOther")}
      </p>
    </div>
  );
}
