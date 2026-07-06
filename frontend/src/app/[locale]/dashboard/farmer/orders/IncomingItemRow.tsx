"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import type { IncomingItem } from "./actions";
import { updateItemStatus } from "./actions";

const STATUS_CLASS: Record<string, string> = {
  PENDING: "bg-warn-50 text-warn-700",
  ACCEPTED: "bg-leaf-50 text-leaf-700",
  REJECTED: "bg-danger-50 text-danger-700",
  PICKED_UP: "bg-sky-tint-50 text-sky-tint-700",
  IN_TRANSIT: "bg-sky-tint-50 text-sky-tint-700",
  DELIVERED: "bg-success-50 text-success-700",
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
  const t = useTranslations("farmer.orders.row.status");
  const cls = STATUS_CLASS[status] ?? "bg-neutral-100 text-neutral-700";
  const label = STATUS_CLASS[status] ? t(status) : status;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

export function IncomingItemRow({ item }: { item: IncomingItem }) {
  const t = useTranslations("farmer.orders.row");
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
            placeholder={t("rejectReasonPlaceholder")}
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
              {t("confirmReject")}
            </button>
            <button
              type="button"
              onClick={() => {
                setRejectMode(false);
                setNote("");
              }}
              className={BTN_NEUTRAL}
            >
              {t("cancel")}
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
              {t("accept")}
            </button>
            <button
              type="button"
              onClick={() => setRejectMode(true)}
              disabled={isPending}
              className={BTN_DANGER_OUTLINE}
            >
              {t("reject")}
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
            {t("markPickedUp")}
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
            {t("markInTransit")}
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
            {t("markDelivered")}
          </button>
        );
      default:
        return <span className="text-xs text-neutral-400">{t("dash")}</span>;
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
