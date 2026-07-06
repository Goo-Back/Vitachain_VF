"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { TrashIcon } from "@/app/[locale]/dashboard/farmer/_ui/Icon";

import { deleteParcel } from "../actions";

export function DeleteParcelButton({ parcelId }: { parcelId: string }) {
  const t = useTranslations("farmer.parcels.detail.deleteButton");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="vc-btn-ghost inline-flex items-center gap-1.5 text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300 hover:text-red-700"
      >
        <TrashIcon size={14} /> {t("delete")}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {error && (
        <span className="text-xs text-red-600">{error}</span>
      )}
      <span className="text-sm font-medium text-red-700">
        {t("confirmPrompt")}
      </span>
      <button
        type="button"
        onClick={() => { setConfirming(false); setError(null); }}
        disabled={pending}
        className="vc-btn-ghost text-sm"
      >
        {t("cancel")}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            const result = await deleteParcel(parcelId);
            if (result && !result.ok) {
              setError(t("failed"));
              setConfirming(false);
            }
          });
        }}
        className="vc-btn-ghost border-red-300 bg-red-50 text-red-700 hover:bg-red-100 hover:border-red-400 text-sm inline-flex items-center gap-1.5"
      >
        <TrashIcon size={13} />
        {pending ? t("deleting") : t("confirm")}
      </button>
    </div>
  );
}
