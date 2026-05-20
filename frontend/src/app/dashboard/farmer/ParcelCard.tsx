import Link from "next/link";

import {
  AlertIcon,
  ArrowUpRightIcon,
  CheckCircleIcon,
  DropletIcon,
  InfoIcon,
  SproutIcon,
} from "./_ui/Icon";
import { formatRelativeFr } from "./format";
import type { ParcelOverviewEntry } from "./overview-types";

/**
 * KAT-14 — clickable parcel summary tile in the overview grid.
 *
 * Tone derivation (KAT-14 §6.4):
 *   - warn         → has_open_threshold_breach (parcel-trouble signal)
 *   - neutral-warn → device_offline_count > 0 (fleet-trouble signal)
 *   - ok           → otherwise
 *
 * Visual upgrade: a coloured top accent band, a moisture progress bar
 * derived from last_soil_moisture, and a stat strip footer with crop /
 * surface / sensors. Click affordance via the corner arrow.
 */

type Tone = "ok" | "neutral-warn" | "warn";

const TONE_BAND: Record<Tone, string> = {
  ok: "bg-gradient-to-r from-leaf-500 to-leaf-300",
  "neutral-warn": "bg-gradient-to-r from-neutral-400 to-neutral-300",
  warn: "bg-gradient-to-r from-warn-500 to-warn-300",
};

const TONE_PILL: Record<Tone, { label: string; cls: string; icon: React.ReactNode }> = {
  ok: { label: "Sain", cls: "vc-pill-ok", icon: <CheckCircleIcon size={12} /> },
  "neutral-warn": {
    label: "Capteur hors-ligne",
    cls: "vc-pill",
    icon: <InfoIcon size={12} />,
  },
  warn: { label: "Seuil dépassé", cls: "vc-pill-warn", icon: <AlertIcon size={12} /> },
};

// 0-100% moisture → human band label, used to colour the bar.
function moistureBand(m: number | null): "low" | "ok" | "high" | null {
  if (m == null) return null;
  if (m < 30) return "low";
  if (m > 80) return "high";
  return "ok";
}

export function ParcelCard({ parcel }: { parcel: ParcelOverviewEntry }) {
  const tone: Tone = parcel.has_open_threshold_breach
    ? "warn"
    : parcel.device_offline_count > 0
      ? "neutral-warn"
      : "ok";

  const pill = TONE_PILL[tone];
  const band = moistureBand(parcel.last_soil_moisture);
  const barColor =
    band === "ok" ? "bg-leaf-500" : band === "low" ? "bg-warn-500" : band === "high" ? "bg-sky-tint-500" : "bg-neutral-300";
  const barWidth = parcel.last_soil_moisture != null ? `${Math.min(100, Math.max(2, parcel.last_soil_moisture))}%` : "0%";

  return (
    <Link
      href={`/dashboard/farmer/parcels/${parcel.parcel_id}`}
      aria-label={`Ouvrir la parcelle ${parcel.name}`}
      className="vc-card vc-card-interactive group relative block overflow-hidden focus:outline-none"
    >
      {/* Top accent band — tonal cue at a glance. */}
      <div className={`h-1.5 w-full ${TONE_BAND[tone]}`} />

      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-semibold tracking-tight text-neutral-900">
              {parcel.name}
            </h3>
            <p className="mt-0.5 truncate text-xs text-neutral-500">
              <SproutIcon size={12} className="mr-1 inline-block text-leaf-600" />
              {parcel.crop_type} · {Number(parcel.surface_area_ha).toFixed(2)} ha
            </p>
          </div>
          <span className={`vc-pill ${pill.cls}`}>
            {pill.icon}
            {pill.label}
          </span>
        </div>

        {/* Soil moisture bar */}
        <div className="mt-5">
          <div className="flex items-baseline justify-between text-xs">
            <span className="flex items-center gap-1.5 text-neutral-500">
              <DropletIcon size={12} className="text-sky-tint-700" />
              Humidité du sol
            </span>
            <span className="font-medium tabular text-neutral-800">
              {parcel.last_soil_moisture != null
                ? `${parcel.last_soil_moisture.toFixed(1)} %`
                : "—"}
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-neutral-100">
            <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: barWidth }} />
          </div>
          <p className="mt-1.5 text-[11px] text-neutral-400">
            Dernière mesure :{" "}
            {parcel.last_reading_at
              ? formatRelativeFr(parcel.last_reading_at)
              : "aucune"}
          </p>
        </div>

        {/* Sensor footer strip */}
        <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-3 text-xs">
          <dl className="grid grid-cols-3 gap-3 text-center">
            <SensorChip label="Actifs" value={parcel.device_active_count} tone="ok" />
            <SensorChip label="Hors-ligne" value={parcel.device_offline_count} tone={parcel.device_offline_count > 0 ? "warn" : "neutral"} />
            <SensorChip label="En attente" value={parcel.device_pending_count + parcel.device_unlinked_count} tone="neutral" />
          </dl>
          <ArrowUpRightIcon
            size={18}
            className="text-neutral-300 transition group-hover:text-leaf-700"
          />
        </div>
      </div>
    </Link>
  );
}

function SensorChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "neutral";
}) {
  const cls = {
    ok: "text-leaf-700",
    warn: "text-warn-700",
    neutral: "text-neutral-600",
  }[tone];
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-neutral-400">
        {label}
      </dt>
      <dd className={`mt-0.5 text-sm font-semibold tabular ${cls}`}>{value}</dd>
    </div>
  );
}
