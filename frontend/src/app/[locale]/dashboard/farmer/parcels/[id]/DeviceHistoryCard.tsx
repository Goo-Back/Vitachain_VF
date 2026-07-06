"use client";

import { useLocale, useTranslations } from "next-intl";

import { toIntlLocale } from "@/lib/intlLocale";

import type { DeviceHistoryEntry, DeviceStatus } from "./telemetry-actions";

interface Props {
  devices: DeviceHistoryEntry[];
  selectedDeviceUuid: string | null;
  onSelectDevice: (uuid: string | null) => void;
}

type Translator = (key: string, values?: Record<string, string | number | Date>) => string;

/**
 * KAT-13 — historical-devices card.
 *
 * Lists every device that ever produced telemetry on this parcel, including
 * UNLINKED rows whose `parcel_id` is frozen by KAT-12. Clicking "Filtrer le
 * graphe" pipes the device UUID into the parent <TelemetrySection>'s history
 * fetch so the chart shows only that device's slice. Default behaviour
 * (no filter) is the unfiltered aggregate.
 *
 * Suppressed entirely when no device has ever produced telemetry — the
 * empty-state copy of the parent section already covers that case.
 */
// i18n-KAT13
export function DeviceHistoryCard({
  devices,
  selectedDeviceUuid,
  onSelectDevice,
}: Props) {
  const t = useTranslations("farmer.parcels.detail.telemetry.deviceHistory");
  const tRelative = useTranslations("farmer.parcels.detail.telemetry.relative");
  const intlLocale = toIntlLocale(useLocale());
  if (devices.length === 0) return null;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-medium">{t("title")}</h3>
        {selectedDeviceUuid && (
          <button
            type="button"
            onClick={() => onSelectDevice(null)}
            className="text-xs font-medium text-emerald-700 hover:underline"
          >
            {t("viewAll")}
          </button>
        )}
      </div>

      <ul className="space-y-2">
        {devices.map((d) => (
          <DeviceHistoryRow
            key={d.device_uuid}
            entry={d}
            isSelected={selectedDeviceUuid === d.device_uuid}
            onToggle={() =>
              onSelectDevice(
                selectedDeviceUuid === d.device_uuid ? null : d.device_uuid,
              )
            }
            t={t}
            tRelative={tRelative}
            locale={intlLocale}
          />
        ))}
      </ul>
    </section>
  );
}

// i18n-KAT13
function DeviceHistoryRow({
  entry,
  isSelected,
  onToggle,
  t,
  tRelative,
  locale,
}: {
  entry: DeviceHistoryEntry;
  isSelected: boolean;
  onToggle: () => void;
  t: Translator;
  tRelative: Translator;
  locale: string;
}) {
  const isUnlinked = entry.device_status === "UNLINKED";
  const rangeLabel = `${formatShortDate(entry.first_recorded_at, t, locale)} → ${formatShortDate(
    entry.last_recorded_at,
    t,
    locale,
  )}`;

  return (
    <li
      className={
        "flex items-center justify-between gap-3 rounded-md border p-3 transition-colors " +
        (isSelected
          ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/30"
          : isUnlinked
            ? "border-neutral-200 bg-neutral-50 opacity-80"
            : "border-neutral-200 bg-white")
      }
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-mono text-sm font-medium">
            {entry.device_id}
          </span>
          {entry.api_key_last4 && (
            <span className="font-mono text-xs text-neutral-500">
              ••••{entry.api_key_last4}
            </span>
          )}
          <StatusPill status={entry.device_status} t={t} />
          {entry.is_currently_paired && (
            <span className="rounded-full border border-emerald-300 bg-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">
              {t("paired")}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
          <span>{rangeLabel}</span>
          <span className="text-neutral-300">·</span>
          <span>{t("readingsCount", { count: entry.sample_count.toLocaleString(locale) })}</span>
          {isUnlinked && entry.device_updated_at && (
            <>
              <span className="text-neutral-300">·</span>
              <span>{t("detached", { relative: formatRelative(entry.device_updated_at, t, tRelative) })}</span>
            </>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onToggle}
        className={
          "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors " +
          (isSelected
            ? "bg-emerald-600 text-white hover:bg-emerald-700"
            : "border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100")
        }
        aria-pressed={isSelected}
      >
        {isSelected ? t("filterActive") : t("filterGraph")}
      </button>
    </li>
  );
}

// i18n-KAT13
function StatusPill({ status, t }: { status: DeviceStatus; t: Translator }) {
  const classes = STATUS_CLASSES[status];
  return (
    <span
      className={
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
        classes
      }
    >
      {t(`status.${STATUS_LABEL_KEY[status]}`)}
    </span>
  );
}

const STATUS_CLASSES: Record<DeviceStatus, string> = {
  PENDING: "bg-neutral-100 text-neutral-700",
  ACTIVE: "bg-emerald-100 text-emerald-800",
  OFFLINE: "bg-amber-100 text-amber-900",
  UNLINKED: "bg-neutral-200 text-neutral-700",
};

const STATUS_LABEL_KEY: Record<DeviceStatus, string> = {
  PENDING: "pending",
  ACTIVE: "active",
  OFFLINE: "offline",
  UNLINKED: "unlinked",
};

// i18n-KAT13
function formatShortDate(iso: string, t: Translator, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return t("dash");
  return d.toLocaleDateString(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// i18n-KAT13 — `t` (deviceHistory scope) supplies the "recently" fallback;
// the actual relative-time buckets come from the shared
// farmer.parcels.detail.telemetry.relative namespace via `tRelative`.
function formatRelative(iso: string, t: Translator, tRelative: Translator): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return t("recently");
  const seconds = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (seconds < 60) return tRelative("seconds", { count: seconds });
  if (seconds < 3600) return tRelative("minutes", { count: Math.floor(seconds / 60) });
  if (seconds < 86400) return tRelative("hours", { count: Math.floor(seconds / 3600) });
  return tRelative("days", { count: Math.floor(seconds / 86400) });
}
