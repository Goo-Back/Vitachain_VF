import type { Locale } from "@/i18n/routing";

/**
 * Maps a next-intl UI locale to the BCP-47 tag used for `Intl`-backed
 * formatting (`Date#toLocaleDateString`, `Number#toLocaleString`, etc).
 *
 * Kept separate from the UI translation locale because number/date
 * formatting conventions need a region subtag to match what this app
 * actually displays:
 * - "ar" maps to "ar-MA" rather than a bare "ar" or "ar-SA" — Morocco's
 *   CLDR data renders Western/Latin digits by default, matching how MAD
 *   amounts and dates are shown everywhere else in the app. A bare "ar"
 *   or "ar-SA" tag can default to Eastern Arabic-Indic digits instead,
 *   which would look wrong here.
 */
const INTL_LOCALE_MAP: Record<Locale, string> = {
  fr: "fr-MA",
  en: "en-GB",
  ar: "ar-MA",
};

/**
 * Resolve a next-intl locale code to its Intl/BCP-47 formatting tag.
 *
 * Takes `string` (not `Locale`) because `useLocale()`/`getLocale()` are
 * typed generically by next-intl unless `AppConfig` is augmented, which
 * this project doesn't do. Falls back to the French tag for any
 * unrecognized value.
 */
export function toIntlLocale(locale: string): string {
  return INTL_LOCALE_MAP[locale as Locale] ?? INTL_LOCALE_MAP.fr;
}
