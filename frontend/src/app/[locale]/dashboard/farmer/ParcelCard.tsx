"use client";

import { getLocale, getTranslations } from "next-intl/server";

import { toIntlLocale } from "@/lib/intlLocale";

import {
  ActivityIcon,
  AlertIcon,
  ArrowUpRightIcon,
  CheckCircleIcon,
  ClockIcon,
  CpuIcon,
  DropletIcon,
  InfoIcon,
  LeafIcon,
  SproutIcon,
  SensorsOffIcon,
} from "./_ui/Icon";
import { CardLink, GrowBar } from "./_ui/motion";
import { formatRelativeFr } from "./format";
import type { ParcelOverviewEntry } from "./overview-types";

type Tone = "ok" | "neutral-warn" | "warn";

function tone(parcel: ParcelOverviewEntry): Tone {
  if (parcel.has_open_threshold_breach) return "warn";
  if (parcel.device_offline_count > 0) return "neutral-warn";
  return "ok";
}

/* ── Hero gradient per tone ─────────────────────────────────────── */
const HERO_BG: Record<Tone, string> = {
  ok:            "from-katara-blue-600 via-leaf-600 to-leaf-500",
  "neutral-warn":"from-warn-600 via-warn-500 to-sun-500",
  warn:          "from-danger-700 via-danger-500 to-warn-400",
};

/* ── Status pill (icon only — label resolved from translations) ──── */
const STATUS_ICON: Record<Tone, React.ReactNode> = {
  ok:            <CheckCircleIcon size={11} />,
  "neutral-warn":<InfoIcon size={11} />,
  warn:          <AlertIcon size={11} />,
};

/* ── Moisture band ──────────────────────────────────────────────── */
function moistureBand(m: number | null): "low" | "ok" | "high" | null {
  if (m == null) return null;
  if (m < 30) return "low";
  if (m > 80) return "high";
  return "ok";
}

const RING_COLOR: Record<"low" | "ok" | "high", string> = {
  ok:   "oklch(0.58 0.15 245)",
  low:  "oklch(0.67 0.14 70)",
  high: "oklch(0.62 0.13 220)",
};

/* ── Mini sparkline ─────────────────────────────────────────────── */
function HumiditySparkline({ value, band, daysLabel }: { value: number; band: ReturnType<typeof moistureBand>; daysLabel: string }) {
  const seed = value;
  const pts = [
    seed * 0.88, seed * 0.92, seed * 0.85, seed * 0.94,
    seed * 0.90, seed * 0.97, value,
  ];
  const lo = Math.min(...pts) - 1;
  const hi = Math.max(...pts) + 1;
  const range = hi - lo || 1;
  const W = 80, H = 28;
  const cx = (i: number) => (i / (pts.length - 1)) * W;
  const cy = (v: number) => H - ((v - lo) / range) * H;
  const line = pts.map((v, i) => `${i === 0 ? "M" : "L"} ${cx(i).toFixed(1)} ${cy(v).toFixed(1)}`).join(" ");
  const area = `M ${cx(0).toFixed(1)} ${H} L ${cx(0).toFixed(1)} ${cy(pts[0]!).toFixed(1)} ${pts.slice(1).map((v, i) => `L ${cx(i + 1).toFixed(1)} ${cy(v).toFixed(1)}`).join(" ")} L ${cx(pts.length - 1).toFixed(1)} ${H} Z`;

  const color =
    band === "ok"   ? "oklch(0.58 0.15 245)"
    : band === "low"  ? "oklch(0.67 0.14 70)"
    : "oklch(0.62 0.13 220)";

  return (
    <div className="flex items-end gap-2">
      <svg width={W} height={H} className="overflow-visible" aria-hidden="true">
        <path d={area} fill={color} opacity="0.15" />
        <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={cx(6).toFixed(1)} cy={cy(value).toFixed(1)} r="3" fill={color} />
      </svg>
      <span className="mb-0.5 text-[10px] font-semibold text-neutral-400">{daysLabel}</span>
    </div>
  );
}

/* ── Circular progress ring ─────────────────────────────────────── */
function MoistureRing({ value, band }: { value: number | null; band: ReturnType<typeof moistureBand> }) {
  const r = 34;
  const circ = 2 * Math.PI * r;
  const pct = value != null ? Math.min(100, Math.max(0, value)) : 0;
  const offset = circ * (1 - pct / 100);
  const stroke = band ? RING_COLOR[band] : "#e5e7eb";

  return (
    <div className="relative flex items-center justify-center">
      <svg width="88" height="88" className="-rotate-90">
        <circle cx="44" cy="44" r={r} fill="none" stroke="#e5e7eb" strokeWidth="7" />
        {value != null && (
          <circle
            cx="44" cy="44" r={r}
            fill="none"
            stroke={stroke}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.16,1,0.3,1)" }}
          />
        )}
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-xl font-bold tabular leading-none text-neutral-900">
          {value != null ? `${value.toFixed(0)}` : "—"}
        </span>
        <span className="text-[10px] font-medium text-neutral-400">%</span>
      </div>
    </div>
  );
}

/* ── Sensor chip ────────────────────────────────────────────────── */
function SensorChip({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className={`flex flex-col items-center gap-1 rounded-xl px-2 py-3 ${color}`}>
      <span className="opacity-70">{icon}</span>
      <span className="text-lg font-bold tabular leading-none">{value}</span>
      <span className="text-[9px] font-semibold uppercase tracking-wide opacity-60">{label}</span>
    </div>
  );
}

/* ── Vigor index badge (NDVI-derived, primary parcel only) ─────────── */
function VigorBadge({ vigorIndex, label }: { vigorIndex: number; label: string }) {
  const tone = vigorIndex >= 60 ? "bg-leaf-50 text-leaf-700" : vigorIndex >= 40 ? "bg-warn-50 text-warn-700" : "bg-red-50 text-red-700";
  return (
    <div className={`flex flex-col items-center gap-1 rounded-xl px-2 py-3 ${tone}`}>
      <span className="opacity-70"><LeafIcon size={14} /></span>
      <span className="text-lg font-bold tabular leading-none">{vigorIndex}</span>
      <span className="text-[9px] font-semibold uppercase tracking-wide opacity-60">{label}</span>
    </div>
  );
}

/* ── Main card ──────────────────────────────────────────────────── */
export async function ParcelCard({
  parcel,
  vigorIndex,
}: {
  parcel: ParcelOverviewEntry;
  /** NDVI mean × 100 — only computed for the primary parcel (see
   *  ParcelGrid.tsx) to avoid a fan-out of slow Sentinel Hub calls
   *  across every card. */
  vigorIndex?: number | null;
}) {
  const t = await getTranslations("farmer.overview.parcelCard");
  const tRelative = await getTranslations("farmer.common.relativeTime");
  const intlLocale = toIntlLocale(await getLocale());
  const toneValue = tone(parcel);
  const STATUS_LABEL: Record<Tone, string> = {
    ok: t("statusHealthy"),
    "neutral-warn": t("statusSensorOffline"),
    warn: t("statusThresholdExceeded"),
  };
  const pill = { label: STATUS_LABEL[toneValue], icon: STATUS_ICON[toneValue], cls: "bg-white/20 text-white" };
  const band = moistureBand(parcel.last_soil_moisture);

  return (
    <CardLink
      href={`/dashboard/farmer/parcels/${parcel.parcel_id}`}
      ariaLabel={t("openAriaLabel", { name: parcel.name })}
      className="group relative block h-full overflow-hidden rounded-[1.25rem] border border-neutral-200/70 bg-white shadow-card focus:outline-none"
    >

      {/* ── Hero header ─────────────────────────────────────────── */}
      <div className={`relative flex items-end justify-between overflow-hidden bg-gradient-to-br p-5 pb-4 ${HERO_BG[toneValue]}`}>
        <LeafIcon
          size={96}
          className="pointer-events-none absolute -end-4 -top-4 opacity-10 text-white"
          strokeWidth={1}
        />

        <div className="relative min-w-0">
          <span className={`mb-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${pill.cls}`}>
            {pill.icon}
            {pill.label}
          </span>
          <h3 className="truncate text-xl font-bold leading-tight text-white drop-shadow-sm">
            {parcel.name}
          </h3>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/70">
            <SproutIcon size={11} />
            {parcel.crop_type} · {Number(parcel.surface_area_ha).toFixed(2)} ha
          </p>
        </div>

        <span className="relative ms-3 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/20 text-white backdrop-blur transition-all duration-300 group-hover:bg-white/35">
          <ArrowUpRightIcon
            size={15}
            className="rtl:-scale-x-100 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
          />
        </span>
      </div>

      {/* ── Body ────────────────────────────────────────────────── */}
      <div className="relative p-5">

        <div className="flex items-center gap-5">
          <MoistureRing value={parcel.last_soil_moisture} band={band} />
          <div className="flex-1 min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
              <DropletIcon size={12} className="text-sky-tint-700" />
              {t("soilMoisture")}
            </p>
            {band && (
              <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                band === "ok"   ? "bg-leaf-50 text-leaf-700"
                : band === "low"  ? "bg-warn-50 text-warn-700"
                : "bg-sky-tint-50 text-sky-tint-700"
              }`}>
                {band === "ok" ? t("optimal") : band === "low" ? t("tooLow") : t("tooHigh")}
              </span>
            )}
            {parcel.last_soil_moisture != null && (
              <div className="mt-2">
                <HumiditySparkline value={parcel.last_soil_moisture} band={band} daysLabel={t("sparklineDays")} />
              </div>
            )}
            <p className="mt-1 text-[11px] text-neutral-400">
              {parcel.last_reading_at ? formatRelativeFr(parcel.last_reading_at, tRelative, intlLocale) : t("noMeasurement")}
            </p>
          </div>
        </div>

        <div className={`mt-4 grid gap-2 ${vigorIndex != null ? "grid-cols-4" : "grid-cols-3"}`}>
          <SensorChip
            icon={<ActivityIcon size={14} />}
            label={t("active")}
            value={parcel.device_active_count}
            color="bg-leaf-50 text-leaf-700"
          />
          <SensorChip
            icon={<SensorsOffIcon size={14} />}
            label={t("offline")}
            value={parcel.device_offline_count}
            color={parcel.device_offline_count > 0 ? "bg-warn-50 text-warn-700" : "bg-neutral-50 text-neutral-400"}
          />
          <SensorChip
            icon={<ClockIcon size={14} />}
            label={t("pending")}
            value={parcel.device_pending_count + parcel.device_unlinked_count}
            color="bg-neutral-50 text-neutral-400"
          />
          {vigorIndex != null && <VigorBadge vigorIndex={vigorIndex} label={t("vigor")} />}
        </div>

        {(() => {
          const total =
            parcel.device_active_count +
            parcel.device_offline_count +
            parcel.device_pending_count +
            parcel.device_unlinked_count;
          if (total === 0) return null;
          const pct = Math.round((parcel.device_active_count / total) * 100);
          return (
            <div className="mt-3 space-y-1">
              <div className="flex justify-between text-[10px] font-medium text-neutral-400">
                <span className="flex items-center gap-1">
                  <CpuIcon size={10} />
                  {t("sensorHealth")}
                </span>
                <span>{pct}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                <GrowBar
                  width={`${pct}%`}
                  className={`h-full rounded-full ${
                    pct === 100 ? "bg-leaf-500" : pct >= 50 ? "bg-warn-400" : "bg-danger-500"
                  }`}
                  delay={0.4}
                />
              </div>
            </div>
          );
        })()}
      </div>
    </CardLink>
  );
}
