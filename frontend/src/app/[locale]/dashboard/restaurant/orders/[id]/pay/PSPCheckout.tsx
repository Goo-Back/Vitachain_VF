"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useState, useTransition } from "react";

import {
  CheckCircleIcon,
  InfoIcon,
  XIcon,
} from "@/app/[locale]/dashboard/farmer/_ui/Icon";
import { PAYMENT_PARTNER, markPaid } from "@/lib/payment";

type Props = {
  orderId: string;
  amount: number;
  reference: string;
};

type Step = "form" | "processing" | "success" | "error";

export function PSPCheckout({ orderId, amount, reference }: Props) {
  const t = useTranslations("restaurant.orders.pay");
  const router = useRouter();
  const [step, setStep] = useState<Step>("form");
  const [card, setCard] = useState("");
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [isPending, startTransition] = useTransition();

  function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!isCardValid(card) || !name || expiry.length < 5 || cvv.length < 3) {
      setStep("error");
      return;
    }
    setStep("processing");
    // Simulated round-trip to PayMaroc — in production the redirect comes from
    // the PSP server, not a timeout.
    startTransition(() => {
      window.setTimeout(() => {
        markPaid(orderId);
        setStep("success");
        window.setTimeout(() => {
          router.push(`/dashboard/restaurant/orders/${orderId}/confirmation`);
        }, 1200);
      }, 1500);
    });
  }

  function handleCancel() {
    // No status change — order remains "due", restaurant can retry later from
    // the order detail page (Reprendre le paiement).
    router.push(`/dashboard/restaurant/orders/${orderId}`);
  }

  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-lifted ring-1 ring-neutral-200">
      <header className="flex items-center justify-between bg-gradient-to-br from-blue-700 to-blue-900 px-6 py-5 text-white">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-blue-100">
            {t("securePayment")}
          </p>
          <p className="mt-0.5 text-lg font-semibold">{PAYMENT_PARTNER.name}</p>
          <p className="text-[11px] text-blue-100">{PAYMENT_PARTNER.tagline}</p>
        </div>
        <span className="grid h-10 w-10 place-items-center rounded-md bg-white/15 ring-1 ring-white/20 text-sm font-bold">
          PM
        </span>
      </header>

      <div className="px-6 py-5">
        <div className="flex items-start justify-between gap-3 rounded-lg bg-neutral-50 p-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-neutral-500">
              {t("refVitaChain")}
            </p>
            <p className="font-mono text-sm font-semibold text-neutral-900">
              {reference}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wider text-neutral-500">
              {t("amountDue")}
            </p>
            <p className="text-xl font-bold text-neutral-900">
              {amount.toFixed(2)} MAD
            </p>
          </div>
        </div>

        {step === "form" && (
          <form onSubmit={handlePay} className="mt-5 space-y-4">
            <Field
              id="card_number"
              label={t("cardNumberLabel")}
              value={card}
              onChange={(v) => setCard(formatCardNumber(v))}
              placeholder="4242 4242 4242 4242"
              autoComplete="cc-number"
              inputMode="numeric"
              maxLength={19}
            />
            <Field
              id="card_name"
              label={t("cardNameLabel")}
              value={name}
              onChange={setName}
              placeholder={t("cardNamePlaceholder")}
              autoComplete="cc-name"
            />
            <div className="grid grid-cols-2 gap-3">
              <Field
                id="card_expiry"
                label={t("expiryLabel")}
                value={expiry}
                onChange={(v) => setExpiry(formatExpiry(v))}
                placeholder="04/29"
                autoComplete="cc-exp"
                inputMode="numeric"
                maxLength={5}
              />
              <Field
                id="card_cvv"
                label={t("cvvLabel")}
                value={cvv}
                onChange={(v) => setCvv(v.replace(/\D/g, "").slice(0, 4))}
                placeholder="123"
                autoComplete="cc-csc"
                inputMode="numeric"
                type="password"
              />
            </div>

            <div className="flex items-center gap-2 text-[11px] text-neutral-500">
              <InfoIcon size={12} />
              {t("dataNotice", { partner: PAYMENT_PARTNER.name })}
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 disabled:opacity-60"
              >
                {t("payButton", { amount: amount.toFixed(2) })}
              </button>
            </div>
          </form>
        )}

        {step === "processing" && (
          <div className="py-10 text-center">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700" />
            <p className="mt-4 text-sm font-medium text-neutral-900">
              {t("processingTitle", { partner: PAYMENT_PARTNER.name })}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              {t("processingBody")}
            </p>
          </div>
        )}

        {step === "success" && (
          <div className="py-10 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-100">
              <CheckCircleIcon size={24} className="text-emerald-700" />
            </div>
            <p className="mt-3 text-sm font-semibold text-neutral-900">
              {t("successTitle")}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              {t("successBody")}
            </p>
          </div>
        )}

        {step === "error" && (
          <div className="mt-5 rounded-lg bg-red-50 p-4 ring-1 ring-red-200">
            <div className="flex items-start gap-3">
              <XIcon size={16} className="mt-0.5 text-red-600" />
              <div>
                <p className="text-sm font-semibold text-red-700">
                  {t("errorTitle")}
                </p>
                <p className="mt-1 text-xs text-red-700">
                  {t("errorBody")}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setStep("form")}
              className="mt-3 text-xs font-medium text-red-700 hover:underline"
            >
              {t("retry")}
            </button>
          </div>
        )}
      </div>

      <footer className="border-t border-neutral-100 bg-neutral-50 px-6 py-3 text-[10px] text-neutral-500">
        {t("footerNote", { partner: PAYMENT_PARTNER.name })}
      </footer>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  ...rest
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-xs font-medium text-neutral-600"
      >
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm font-mono focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
        {...rest}
      />
    </div>
  );
}

function formatCardNumber(raw: string): string {
  return raw
    .replace(/\D/g, "")
    .slice(0, 16)
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

function formatExpiry(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function isCardValid(formatted: string): boolean {
  const digits = formatted.replace(/\s/g, "");
  return digits.length >= 13 && digits.length <= 19;
}
