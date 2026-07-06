"use client";

import { useLocale, useTranslations } from "next-intl";

import { toIntlLocale } from "@/lib/intlLocale";
import {
  CalendarIcon,
  InfoIcon,
  RulerIcon,
  SatelliteIcon,
  SproutIcon,
} from "../_ui/Icon";
import { FadeIn } from "../_ui/motion";
import { bandFor, vigorIndexFromNdvi } from "../ndvi-format";

import type { NdviResponse } from "./actions";

/**
 * Shared NDVI rendering — used by the standalone /satellite page and by the
 * "Satellite" tab on the parcel detail page, so both surfaces stay in sync.
 */

type Tone = "healthy" | "moderate" | "stressed" | "bare";

function toneForNdvi(mean: number): Tone {
  if (mean >= 0.4) return "healthy";
  if (mean >= 0.2) return "moderate";
  if (mean >= 0) return "stressed";
  return "bare";
}

const HERO_GRADIENT: Record<Tone, string> = {
  healthy: "from-katara-blue-600 via-leaf-600 to-leaf-500",
  moderate: "from-warn-600 via-warn-500 to-sun-500",
  stressed: "from-danger-700 via-danger-500 to-warn-400",
  bare: "from-soil-700 via-soil-500 to-soil-300",
};

/* ── Circular NDVI gauge ─────────────────────────────────────────── */
function NdviGauge({ mean }: { mean: number }) {
  const vigor = vigorIndexFromNdvi(mean);
  const r = 46;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - vigor / 100);

  return (
    <div className="relative flex items-center justify-center">
      <svg width="116" height="116" className="-rotate-90">
        <circle cx="58" cy="58" r={r} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="9" />
        <circle
          cx="58"
          cy="58"
          r={r}
          fill="none"
          stroke="white"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(0.16,1,0.3,1)" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-bold tabular leading-none text-white drop-shadow-sm">
          {mean.toFixed(2)}
        </span>
        <span className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-white/70">
          NDVI
        </span>
      </div>
    </div>
  );
}

/* ── Gradient legend with a position pointer ────────────────────── */
function NdviLegend({ mean }: { mean: number }) {
  const t = useTranslations("farmer.satellite.panel");
  // NDVI realistically spans ~ -0.2 (bare soil/water) to ~0.9 (dense canopy).
  const pct = Math.min(100, Math.max(0, ((mean + 0.2) / 1.2) * 100));

  return (
    <div className="vc-card p-5">
      <p className="vc-eyebrow">{t("scaleTitle")}</p>
      <div className="relative mt-4">
        <div
          className="h-2.5 w-full rounded-full"
          style={{
            background:
              "linear-gradient(90deg, #a98c59 0%, #edd98c 28%, #c8db6b 50%, #6dc14d 72%, #2e8530 100%)",
          }}
        />
        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-[left] duration-700 ease-out"
          style={{ left: `${pct}%` }}
        >
          <div className="h-4 w-4 rounded-full border-2 border-white bg-neutral-900 shadow-md" />
        </div>
      </div>
      <div className="mt-2 flex justify-between text-[10px] font-medium text-neutral-400">
        <span>{t("scaleBare")}</span>
        <span>{t("scaleModerate")}</span>
        <span>{t("scaleDense")}</span>
      </div>
    </div>
  );
}

function MetaChip({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-neutral-100 bg-neutral-50/70 px-3 py-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-neutral-500 shadow-sm ring-1 ring-neutral-100">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
          {label}
        </p>
        <p className="truncate text-sm font-semibold text-neutral-800">{value}</p>
      </div>
    </div>
  );
}

export function SatelliteView({
  data,
  parcelMeta,
}: {
  data: NdviResponse;
  /** Optional context chips — omitted gracefully when not available. */
  parcelMeta?: { cropType?: string; surfaceAreaHa?: number };
}) {
  const t = useTranslations("farmer.satellite.panel");
  const tBands = useTranslations("farmer.common.ndviBands");
  const intlLocale = toIntlLocale(useLocale());
  const band = bandFor(data.mean_ndvi, tBands);
  const tone = toneForNdvi(data.mean_ndvi);
  const acquisitionLabel = new Date(data.acquisition_date).toLocaleDateString(
    intlLocale,
    { day: "numeric", month: "long", year: "numeric" },
  );

  return (
    <FadeIn className="space-y-6">
      {/* ── Hero ──────────────────────────────────────────────────── */}
      <div
        className={`relative overflow-hidden rounded-[1.25rem] bg-gradient-to-br p-6 shadow-card sm:p-7 ${HERO_GRADIENT[tone]}`}
      >
        <SatelliteIcon
          size={140}
          className="pointer-events-none absolute -end-6 -top-6 text-white opacity-10"
        />
        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white">
              {band.label}
            </span>
            <h2 className="mt-2 text-2xl font-bold leading-tight text-white drop-shadow-sm">
              {t("vigorTitle")}
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/75">
              <CalendarIcon size={13} /> {t("acquisition", { date: acquisitionLabel })}
              <span className="text-white/40">·</span>
              {t("sentinel2L2A")}
            </p>
            <p className="mt-3 max-w-md text-sm text-white/90">{band.advice}</p>
          </div>

          <NdviGauge mean={data.mean_ndvi} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* ── Image ─────────────────────────────────────────────── */}
        <div className="vc-card group overflow-hidden">
          <div className="relative aspect-square w-full overflow-hidden bg-neutral-100">
            {data.image_data_url ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={data.image_data_url}
                  alt={t("imageAlt")}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <a
                  href={data.image_data_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute end-3 top-3 rounded-lg bg-white/90 px-2.5 py-1.5 text-xs font-medium text-neutral-700 opacity-0 shadow-sm backdrop-blur transition-opacity duration-200 group-hover:opacity-100"
                >
                  {t("expand")}
                </a>
              </>
            ) : (
              <div className="grid h-full place-items-center px-6 text-center text-sm text-neutral-500">
                {t("imageUnavailable")}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 px-4 py-3 text-xs text-neutral-600">
            <span className="inline-flex items-center gap-1.5">
              <SatelliteIcon size={14} className="text-leaf-600" />
              {t("copernicus")}
            </span>
            <span>{t("resolution")}</span>
          </div>
        </div>

        {/* ── Side panel ────────────────────────────────────────── */}
        <div className="space-y-4">
          <NdviLegend mean={data.mean_ndvi} />

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
            {parcelMeta?.cropType ? (
              <MetaChip
                icon={<SproutIcon size={16} />}
                label={t("cropLabel")}
                value={parcelMeta.cropType}
              />
            ) : null}
            {parcelMeta?.surfaceAreaHa != null ? (
              <MetaChip
                icon={<RulerIcon size={16} />}
                label={t("surfaceLabel")}
                value={`${parcelMeta.surfaceAreaHa.toFixed(2)} ha`}
              />
            ) : null}
            <MetaChip
              icon={<CalendarIcon size={16} />}
              label={t("revisitLabel")}
              value={t("revisitValue")}
            />
          </div>
        </div>
      </div>
    </FadeIn>
  );
}

export function SatelliteUnavailablePanel() {
  const t = useTranslations("farmer.satellite.panel");
  return (
    <div className="vc-card flex items-start gap-4 p-6">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-warn-50 text-warn-700">
        <InfoIcon size={20} />
      </span>
      <div>
        <p className="text-sm font-semibold text-neutral-900">
          {t("unavailableTitle")}
        </p>
        <p className="mt-1 text-sm text-neutral-600">
          {t.rich("unavailableBody", {
            code1: (chunks) => (
              <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs font-mono">
                {chunks}
              </code>
            ),
            code2: (chunks) => (
              <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs font-mono">
                {chunks}
              </code>
            ),
          })}
        </p>
      </div>
    </div>
  );
}
