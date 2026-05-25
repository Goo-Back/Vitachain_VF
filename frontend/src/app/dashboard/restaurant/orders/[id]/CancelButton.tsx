"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { cancelOrder } from "../actions";

export function CancelButton({ orderId }: { orderId: string }) {
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
          ? "Annulation…"
          : confirm
            ? "Confirmer l'annulation"
            : "Annuler la commande"}
      </button>
      {error && (
        <p className="mt-2 text-xs text-red-700">Erreur : {error}</p>
      )}
      <p className="mt-2 text-[11px] text-neutral-400">
        Annulation possible tant que la commande est en attente d&apos;acceptation.
      </p>
    </div>
  );
}
