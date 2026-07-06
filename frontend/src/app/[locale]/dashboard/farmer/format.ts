/**
 * KAT-14 — light formatting helpers for the overview surface.
 *
 * Avoids a new `date-fns` dependency for what is two short strings. The
 * detail page uses toLocaleDateString directly; the overview wants
 * "il y a 12 min" granularity, hence the small relative formatter below.
 *
 * Both helpers take a `t` translator (scoped to farmer.common.weather /
 * farmer.common.relativeTime) so this plain-TS module never has to call
 * next-intl's hooks/getTranslations itself — the calling component (always
 * a Server or Client Component that already has a translator in scope)
 * resolves the copy.
 */

import type { WeatherIconKind } from "./weather/actions";

type Translator = (key: string, values?: Record<string, string | number | Date>) => string;

/**
 * Shared weather icon/label mapping — used by StatusRow's weather card and
 * KpiStrip's Forecast tile so both surfaces agree on wording.
 */
export function weatherMeta(
  kind: WeatherIconKind | undefined,
  t: Translator,
): {
  icon: string;
  title: string;
  short: string;
} {
  if (!kind) return { icon: "cloud_off", title: t("unavailableTitle"), short: t("unavailableShort") };
  if (kind === "sun")   return { icon: "wb_sunny",    title: t("sunTitle"), short: t("sunShort") };
  if (kind === "rain")  return { icon: "rainy",       title: t("rainTitle"), short: t("rainShort") };
  if (kind === "storm") return { icon: "thunderstorm",title: t("stormTitle"), short: t("stormShort") };
  if (kind === "snow")  return { icon: "weather_snowy", title: t("snowTitle"), short: t("snowShort") };
  if (kind === "fog")   return { icon: "foggy",       title: t("fogTitle"), short: t("fogShort") };
  return                       { icon: "cloud",       title: t("cloudTitle"), short: t("cloudShort") };
}

export function formatRelativeFr(iso: string, t: Translator, locale: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const delta = Math.max(0, now - then);
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return t("justNow");
  const min = Math.floor(sec / 60);
  if (min < 60) return t("minutesAgo", { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("hoursAgo", { count: hr });
  const day = Math.floor(hr / 24);
  if (day < 30) return t("daysAgo", { count: day });
  // Beyond ~1 month the absolute date is more useful than "il y a 42 j".
  return new Date(iso).toLocaleDateString(locale);
}
