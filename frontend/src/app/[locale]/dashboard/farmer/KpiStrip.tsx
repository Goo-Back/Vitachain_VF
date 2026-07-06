import { getTranslations } from "next-intl/server";

import {
  AlertIcon,
  DropletIcon,
  MapPinIcon,
  MIcon,
} from "./_ui/Icon";
import { MotionCard, Stagger } from "./_ui/motion";
import { weatherMeta } from "./format";
import type { FarmKpiRollup } from "./overview-types";
import type { WeatherCurrent } from "./weather/actions";

/**
 * KAT-14 — farm-wide rollup tiles above the parcel grid.
 *
 * Visual upgrade: each tile gets a tinted icon, a primary numeric value,
 * and a secondary "delta" line that contextualises the count (offline /
 * pending / unlinked sensors under the active count, hectares under the
 * parcel count, etc.). The alert tile flips to a warning tone when the
 * count is non-zero — the only colour cue on the strip by design.
 */

export async function KpiStrip({
  kpi,
  weather,
}: {
  kpi: FarmKpiRollup;
  weather: WeatherCurrent | null;
}) {
  const t = await getTranslations("farmer.overview.kpi");
  const tWeather = await getTranslations("farmer.common.weather");
  const alertTone = kpi.open_alert_count > 0 ? "danger" : "leaf";
  const wMeta = weatherMeta(weather?.icon_kind, tWeather);
  const devicesTotal =
    kpi.device_active_count +
    kpi.device_offline_count +
    kpi.device_pending_count +
    kpi.device_unlinked_count;

  return (
    <Stagger
      as="section"
      ariaLabel={t("ariaLabel")}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
    >
      <MotionCard as="div" interactive={false}>
        <Tile
          icon={<MapPinIcon size={18} />}
          tint="info"
          label={t("parcelsTile")}
          value={kpi.parcel_count}
          sub={t("totalSurfaceSub", { value: Number(kpi.total_surface_ha).toFixed(2) })}
        />
      </MotionCard>
      <MotionCard as="div" interactive={false}>
        <Tile
          icon={<DropletIcon size={18} />}
          tint="info"
          label={t("activeSensorsTile")}
          value={devicesTotal > 0 ? `${kpi.device_active_count}/${devicesTotal}` : kpi.device_active_count}
          sub={
            kpi.device_offline_count + kpi.device_pending_count + kpi.device_unlinked_count > 0
              ? [
                  kpi.device_offline_count > 0 ? t("offlineCount", { count: kpi.device_offline_count }) : null,
                  kpi.device_pending_count > 0 ? t("pendingCount", { count: kpi.device_pending_count }) : null,
                  kpi.device_unlinked_count > 0 ? t("unlinkedCount", { count: kpi.device_unlinked_count }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : t("allOperational")
          }
        />
      </MotionCard>
      <MotionCard as="div" interactive={false}>
        <Tile
          icon={<MIcon name={wMeta.icon} size={18} fill weight={400} />}
          tint={weather ? "sun" : "neutral"}
          label={t("forecastTile")}
          value={wMeta.short}
          sub={weather ? `${Math.round(weather.temp_c)}°C · ${weather.city_label}` : t("weatherUnavailable")}
        />
      </MotionCard>
      <MotionCard as="div" interactive={false}>
        <Tile
          icon={<AlertIcon size={18} />}
          tint={alertTone === "danger" ? "danger" : "leaf"}
          label={t("alertsTile")}
          value={kpi.open_alert_count}
          sub={
            kpi.open_alert_count > 0
              ? t("parcelsToVerify", { count: kpi.parcels_with_open_breach })
              : t("noThresholdExceeded")
          }
          emphasise={alertTone === "danger"}
          emphasiseBadge={t("toVerifyBadge")}
        />
      </MotionCard>
      <MotionCard as="div" interactive={false}>
        <Tile
          icon={<MapPinIcon size={18} />}
          tint="soil"
          label={t("surfaceTile")}
          value={`${Number(kpi.total_surface_ha).toFixed(2)} ha`}
          sub={kpi.parcel_count > 0 ? t("surfacePerParcel", { value: (Number(kpi.total_surface_ha) / kpi.parcel_count).toFixed(2) }) : t("surfaceNoParcel")}
        />
      </MotionCard>
    </Stagger>
  );
}

function Tile({
  icon,
  tint,
  label,
  value,
  sub,
  emphasise,
  emphasiseBadge,
}: {
  icon: React.ReactNode;
  tint: "leaf" | "soil" | "info" | "warn" | "danger" | "sun" | "neutral";
  label: string;
  value: string | number;
  sub: string;
  emphasise?: boolean;
  emphasiseBadge?: string;
}) {
  const tintMap = {
    leaf: { bg: "bg-leaf-50", fg: "text-leaf-700", border: "border-leaf-100" },
    soil: { bg: "bg-soil-50", fg: "text-soil-700", border: "border-soil-100" },
    info: { bg: "bg-sky-tint-50", fg: "text-sky-tint-700", border: "border-sky-tint-50" },
    warn: { bg: "bg-warn-50", fg: "text-warn-700", border: "border-warn-500/30" },
    danger: { bg: "bg-red-50", fg: "text-red-700", border: "border-red-200" },
    sun: { bg: "bg-sun-50", fg: "text-sun-700", border: "border-sun-500/30" },
    neutral: { bg: "bg-neutral-50", fg: "text-neutral-500", border: "border-neutral-200" },
  }[tint];

  return (
    <div
      className={`katara-card group h-full overflow-hidden p-4 ${
        emphasise ? "bg-red-50/60 ring-1 ring-red-300" : ""
      }`}
    >
      <span aria-hidden="true" className="katara-glow" />
      <div className="flex items-start justify-between">
        <span
          className={`grid h-9 w-9 place-items-center rounded-xl ${tintMap.bg} ${tintMap.fg} ring-1 ring-inset ring-black/[0.03] transition-transform duration-300 group-hover:scale-105`}
        >
          {icon}
        </span>
        {emphasise ? (
          <span className="vc-pill vc-pill-danger">{emphasiseBadge}</span>
        ) : null}
      </div>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className="mt-0.5 text-3xl font-semibold tabular tracking-tight text-neutral-900">
        {value}
      </p>
      <p className="mt-1 text-xs text-neutral-500">{sub}</p>
    </div>
  );
}
