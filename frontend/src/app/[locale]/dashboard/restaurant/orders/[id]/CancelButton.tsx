"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

import { cancelOrder } from "../actions";

export function CancelButton({ orderId }: { orderId: string }) {
  const t = useTranslations("restaurant.orders.cancelButton");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    startTransition(async () => {
      const result = await cancelOrder(orderId);
      if (!result.ok) {
        setError(result.error ?? "cancel_failed");
        setConfirm(false);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="w-full rounded border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
      >
        {isPending
          ? t("cancelling")
          : confirm
            ? t("confirmCancel")
            : t("cancelOrder")}
      </button>
      {error && (
        <p className="mt-2 text-xs text-red-700">{t("errorPrefix", { error })}</p>
      )}
      <p className="mt-2 text-[11px] text-neutral-400">
        {t("hint")}
      </p>
    </div>
  );
}
