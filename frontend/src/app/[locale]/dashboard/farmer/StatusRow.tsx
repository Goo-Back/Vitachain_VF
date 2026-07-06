import { getTranslations } from "next-intl/server";

import { MIcon } from "./_ui/Icon";
import { MotionCard, Stagger } from "./_ui/motion";
import { weatherMeta } from "./format";
import type { WeatherCurrent } from "./weather/actions";
import type { FarmKpiRollup } from "./overview-types";

export async function StatusRow({
  weather,
  kpi,
}: {
  weather: WeatherCurrent | null;
  kpi: FarmKpiRollup;
}) {
  const t = await getTranslations("farmer.overview.status");
  const tWeather = await getTranslations("farmer.common.weather");
  const troubled  = kpi.device_offline_count + kpi.device_pending_count;
  const sensorsOk = troubled === 0 && kpi.device_active_count > 0;
  const noSensors = kpi.device_active_count === 0 && troubled === 0;

  const wMeta = weatherMeta(weather?.icon_kind, tWeather);

  const weatherDetail = weather
    ? `${weather.description} · ${Math.round(weather.temp_c)}°C · ${weather.city_label}`
    : t("weatherUnavailableDetail");

  const sensorTitle = sensorsOk
    ? t("sensorsOk")
    : noSensors
      ? t("noSensors")
      : t("sensorsAlert");

  const sensorDetail = noSensors
    ? t("noSensorsDetail")
    : troubled > 0
      ? t("troubledDetail", { troubled, parcelCount: kpi.parcel_count })
      : t("okDetail", { active: kpi.device_active_count, parcelCount: kpi.parcel_count });

  return (
    <Stagger
      as="section"
      ariaLabel={t("ariaLabel")}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
    >
      {/* ── Météo ── */}
      <MotionCard as="div" interactive={false}>
        <StatusCard
          iconName={wMeta.icon}
          iconBg={weather ? "#e8f5e9" : "#f3f4f6"}
          iconColor={weather ? "#2e7d32" : "#6b7280"}
          title={wMeta.title}
          detail={weatherDetail}
          badge={weather ? t("favorable") : t("dash")}
          badgeColor={weather ? "text-leaf-700" : "text-neutral-400"}
          dotColor={weather ? "bg-leaf-500" : "bg-neutral-400"}
          pulse={false}
        />
      </MotionCard>

      {/* ── Capteurs IoT ── */}
      <MotionCard as="div" interactive={false}>
        <StatusCard
          iconName={sensorsOk ? "sensors" : noSensors ? "sensors" : "sensors_off"}
          iconBg={sensorsOk ? "#e8f5e9" : noSensors ? "#f3f4f6" : "#fecaca"}
          iconColor={sensorsOk ? "#2e7d32" : noSensors ? "#6b7280" : "#b91c1c"}
          title={sensorTitle}
          detail={sensorDetail}
          badge={sensorsOk ? t("ok") : noSensors ? t("dash") : t("critical")}
          badgeColor={sensorsOk ? "text-leaf-700" : noSensors ? "text-neutral-400" : "text-red-700"}
          dotColor={sensorsOk ? "bg-leaf-500" : noSensors ? "bg-neutral-400" : "bg-red-600"}
          pulse={!sensorsOk && !noSensors}
          critical={!sensorsOk && !noSensors}
        />
      </MotionCard>
    </Stagger>
  );
}

function StatusCard({
  iconName,
  iconBg,
  iconColor,
  title,
  detail,
  badge,
  badgeColor,
  dotColor,
  pulse,
  critical = false,
}: {
  iconName: string;
  iconBg: string;
  iconColor: string;
  title: string;
  detail: string;
  badge: string;
  badgeColor: string;
  dotColor: string;
  pulse: boolean;
  critical?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-4 rounded-2xl p-5 shadow-sm ring-1 ${
        critical
          ? "bg-red-50 ring-red-200"
          : "bg-white ring-neutral-100"
      }`}
    >
      <span
        className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-full"
        style={{ backgroundColor: iconBg, color: iconColor }}
      >
        <MIcon name={iconName} size={24} fill weight={400} />
      </span>

      <div className="min-w-0 flex-1">
        <h3 className={`text-sm font-bold leading-tight ${critical ? "text-red-900" : "text-neutral-900"}`}>
          {title}
        </h3>
        <p className={`mt-0.5 text-xs leading-snug ${critical ? "text-red-700/80" : "text-neutral-500"}`}>
          {detail}
        </p>
      </div>

      <div className="flex flex-shrink-0 items-center gap-1.5">
        <span className={`h-2.5 w-2.5 rounded-full ${dotColor} ${pulse ? "animate-pulse" : ""}`} />
        <span className={`text-[10px] font-bold uppercase tracking-wider ${badgeColor}`}>
          {badge}
        </span>
      </div>
    </div>
  );
}
