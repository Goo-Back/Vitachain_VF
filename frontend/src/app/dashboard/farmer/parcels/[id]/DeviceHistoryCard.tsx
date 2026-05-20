"use client";

import type { DeviceHistoryEntry, DeviceStatus } from "./telemetry-actions";

interface Props {
  devices: DeviceHistoryEntry[];
  selectedDeviceUuid: string | null;
  onSelectDevice: (uuid: string | null) => void;
}

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
  if (devices.length === 0) return null;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-medium">Historique des capteurs</h3>
        {selectedDeviceUuid && (
          <button
            type="button"
            onClick={() => onSelectDevice(null)}
            className="text-xs font-medium text-emerald-700 hover:underline"
          >
            Voir tous les capteurs
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
}: {
  entry: DeviceHistoryEntry;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const isUnlinked = entry.device_status === "UNLINKED";
  const rangeLabel = `${formatShortDate(entry.first_recorded_at)} → ${formatShortDate(
    entry.last_recorded_at,
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
          <StatusPill status={entry.device_status} />
          {entry.is_currently_paired && (
            <span className="rounded-full border border-emerald-300 bg-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">
              Associé
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
          <span>{rangeLabel}</span>
          <span className="text-neutral-300">·</span>
          <span>{entry.sample_count.toLocaleString("fr-FR")} lectures</span>
          {isUnlinked && entry.device_updated_at && (
            <>
              <span className="text-neutral-300">·</span>
              <span>Détaché {formatRelative(entry.device_updated_at)}</span>
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
        {isSelected ? "Filtre actif" : "Filtrer le graphe"}
      </button>
    </li>
  );
}

// i18n-KAT13
function StatusPill({ status }: { status: DeviceStatus }) {
  const { label, classes } = STATUS_STYLES[status];
  return (
    <span
      className={
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
        classes
      }
    >
      {label}
    </span>
  );
}

const STATUS_STYLES: Record<
  DeviceStatus,
  { label: string; classes: string }
> = {
  PENDING: {
    label: "En attente",
    classes: "bg-neutral-100 text-neutral-700",
  },
  ACTIVE: {
    label: "Actif",
    classes: "bg-emerald-100 text-emerald-800",
  },
  OFFLINE: {
    label: "Hors-ligne",
    classes: "bg-amber-100 text-amber-900",
  },
  UNLINKED: {
    label: "Détaché",
    classes: "bg-neutral-200 text-neutral-700",
  },
};

// i18n-KAT13
function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// i18n-KAT13
function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "récemment";
  const seconds = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (seconds < 60) return `il y a ${seconds} s`;
  if (seconds < 3600) return `il y a ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `il y a ${Math.floor(seconds / 3600)} h`;
  return `il y a ${Math.floor(seconds / 86400)} j`;
}
