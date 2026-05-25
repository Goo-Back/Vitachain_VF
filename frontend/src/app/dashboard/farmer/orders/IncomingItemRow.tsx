"use client";

import { useState, useTransition } from "react";

import type { IncomingItem } from "./actions";
import { updateItemStatus } from "./actions";

const ITEM_STATUS_LABELS: Record<string, { fr: string; cls: string }> = {
  PENDING: { fr: "En attente", cls: "bg-blue-100 text-blue-700" },
  ACCEPTED: { fr: "Acceptée", cls: "bg-emerald-100 text-emerald-700" },
  REJECTED: { fr: "Refusée", cls: "bg-red-100 text-red-700" },
  PICKED_UP: { fr: "Récupérée", cls: "bg-sky-100 text-sky-700" },
  IN_TRANSIT: { fr: "En transit", cls: "bg-sky-100 text-sky-700" },
  DELIVERED: { fr: "Livrée", cls: "bg-green-100 text-green-700" },
};

function Badge({ status }: { status: string }) {
  const def = ITEM_STATUS_LABELS[status] ?? {
    fr: status,
    cls: "bg-neutral-100 text-neutral-700",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${def.cls}`}
    >
      {def.fr}
    </span>
  );
}

export function IncomingItemRow({ item }: { item: IncomingItem }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [note, setNote] = useState("");

  function doUpdate(new_status: IncomingItem["status"], producer_note?: string) {
    setError(null);
    startTransition(async () => {
      const result = await updateItemStatus(item.id, {
        new_status,
        producer_note,
      });
      if (!result.ok) {
        setError(result.error ?? "update_failed");
      }
    });
  }

  function renderActions(): React.ReactNode {
    if (rejectMode) {
      return (
        <div className="flex flex-col gap-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Motif (facultatif, ne pas inclure de coordonnées)"
            maxLength={500}
            rows={2}
            className="w-full rounded border border-neutral-200 px-2 py-1 text-xs"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => doUpdate("REJECTED", note.trim() || undefined)}
              disabled={isPending}
              className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Confirmer le refus
            </button>
            <button
              type="button"
              onClick={() => {
                setRejectMode(false);
                setNote("");
              }}
              className="rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
            >
              Annuler
            </button>
          </div>
        </div>
      );
    }

    switch (item.status) {
      case "PENDING":
        return (
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => doUpdate("ACCEPTED")}
              disabled={isPending}
              className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Accepter
            </button>
            <button
              type="button"
              onClick={() => setRejectMode(true)}
              disabled={isPending}
              className="rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Refuser
            </button>
          </div>
        );
      case "ACCEPTED":
        return (
          <button
            type="button"
            onClick={() => doUpdate("PICKED_UP")}
            disabled={isPending}
            className="rounded bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            Marquer récupérée
          </button>
        );
      case "PICKED_UP":
        return (
          <button
            type="button"
            onClick={() => doUpdate("IN_TRANSIT")}
            disabled={isPending}
            className="rounded bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            En transit
          </button>
        );
      case "IN_TRANSIT":
        return (
          <button
            type="button"
            onClick={() => doUpdate("DELIVERED")}
            disabled={isPending}
            className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            Marquer livrée
          </button>
        );
      default:
        return <span className="text-xs text-neutral-400">—</span>;
    }
  }

  return (
    <tr className="hover:bg-neutral-50">
      <td className="px-4 py-3 font-mono text-xs text-neutral-500">
        {item.resto_handle.slice(0, 8)}…
      </td>
      <td className="px-4 py-3 font-mono text-xs text-neutral-500">
        {item.ad_id.slice(0, 8)}…
      </td>
      <td className="px-4 py-3 text-neutral-700">
        {Number(item.quantity_kg).toFixed(2)} kg
      </td>
      <td className="px-4 py-3 font-medium text-leaf-700">
        {Number(item.line_total_mad).toFixed(2)} MAD
      </td>
      <td className="px-4 py-3 text-neutral-600">{item.delivery_region}</td>
      <td className="px-4 py-3">
        <Badge status={item.status} />
        {item.producer_note && (
          <p className="mt-1 max-w-xs truncate text-[11px] italic text-neutral-500">
            « {item.producer_note} »
          </p>
        )}
      </td>
      <td className="px-4 py-3">
        {renderActions()}
        {error && (
          <p className="mt-1 text-[11px] text-red-700">{error}</p>
        )}
      </td>
    </tr>
  );
}
