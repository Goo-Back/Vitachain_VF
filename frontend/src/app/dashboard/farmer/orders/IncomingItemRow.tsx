"use client";

import { useState, useTransition } from "react";

import type { IncomingItem } from "./actions";
import { updateItemStatus } from "./actions";

const ITEM_STATUS_LABELS: Record<string, { fr: string; cls: string }> = {
  PENDING: { fr: "En attente", cls: "bg-warn-50 text-warn-700" },
  ACCEPTED: { fr: "Acceptée", cls: "bg-leaf-50 text-leaf-700" },
  REJECTED: { fr: "Refusée", cls: "bg-danger-50 text-danger-700" },
  PICKED_UP: { fr: "Récupérée", cls: "bg-sky-tint-50 text-sky-tint-700" },
  IN_TRANSIT: { fr: "En transit", cls: "bg-sky-tint-50 text-sky-tint-700" },
  DELIVERED: { fr: "Livrée", cls: "bg-success-50 text-success-700" },
};

// Small action-button presets, kept on-brand with the Katara theme.
const BTN_FORWARD =
  "katara-gradient-strong inline-flex items-center rounded-lg px-2.5 py-1.5 text-xs font-medium text-white shadow-sm transition hover:brightness-105 disabled:opacity-50";
const BTN_DANGER_SOLID =
  "inline-flex items-center rounded-lg bg-danger-500 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-danger-700 disabled:opacity-50";
const BTN_DANGER_OUTLINE =
  "inline-flex items-center rounded-lg border border-danger-500/40 px-2.5 py-1.5 text-xs font-medium text-danger-700 transition hover:bg-danger-50 disabled:opacity-50";
const BTN_NEUTRAL =
  "inline-flex items-center rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-600 transition hover:bg-neutral-50";

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
        <div className="flex min-w-[220px] flex-col gap-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Motif (facultatif, ne pas inclure de coordonnées)"
            maxLength={500}
            rows={2}
            className="vc-input text-xs"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => doUpdate("REJECTED", note.trim() || undefined)}
              disabled={isPending}
              className={BTN_DANGER_SOLID}
            >
              Confirmer le refus
            </button>
            <button
              type="button"
              onClick={() => {
                setRejectMode(false);
                setNote("");
              }}
              className={BTN_NEUTRAL}
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
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => doUpdate("ACCEPTED")}
              disabled={isPending}
              className={BTN_FORWARD}
            >
              Accepter
            </button>
            <button
              type="button"
              onClick={() => setRejectMode(true)}
              disabled={isPending}
              className={BTN_DANGER_OUTLINE}
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
            className={BTN_FORWARD}
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
            className={BTN_FORWARD}
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
            className={BTN_FORWARD}
          >
            Marquer livrée
          </button>
        );
      default:
        return <span className="text-xs text-neutral-400">—</span>;
    }
  }

  return (
    <tr className="transition-colors hover:bg-leaf-50/40">
      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-500">
        {item.resto_handle.slice(0, 8)}…
      </td>
      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-500">
        {item.ad_id.slice(0, 8)}…
      </td>
      <td className="whitespace-nowrap px-4 py-3 tabular text-neutral-700">
        {Number(item.quantity_kg).toFixed(2)} kg
      </td>
      <td className="whitespace-nowrap px-4 py-3 font-semibold tabular text-leaf-700">
        {Number(item.line_total_mad).toFixed(2)} MAD
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-neutral-600">{item.delivery_region}</td>
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
          <p className="mt-1 text-[11px] text-danger-700">{error}</p>
        )}
      </td>
    </tr>
  );
}
