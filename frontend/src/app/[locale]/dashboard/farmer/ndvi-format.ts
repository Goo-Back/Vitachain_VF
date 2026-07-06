type Translator = (key: string, values?: Record<string, string | number | Date>) => string;

/**
 * Shared NDVI banding logic — used by satellite/page.tsx's full view and
 * SatelliteCard's overview preview, and to derive the Vigor Index badge on
 * the primary parcel card (Vigor Index = mean_ndvi * 100).
 *
 * `t` is scoped to farmer.common.ndviBands so this plain-TS module never
 * has to call next-intl's hooks/getTranslations itself.
 */
export function bandFor(mean: number, t: Translator): { label: string; cls: string; advice: string } {
  if (mean >= 0.6) {
    return {
      label: t("veryDense.label"),
      cls: "vc-pill-ok",
      advice: t("veryDense.advice"),
    };
  }
  if (mean >= 0.4) {
    return {
      label: t("dense.label"),
      cls: "vc-pill-ok",
      advice: t("dense.advice"),
    };
  }
  if (mean >= 0.2) {
    return {
      label: t("moderate.label"),
      cls: "vc-pill-warn",
      advice: t("moderate.advice"),
    };
  }
  if (mean >= 0) {
    return {
      label: t("low.label"),
      cls: "vc-pill-warn",
      advice: t("low.advice"),
    };
  }
  return {
    label: t("bare.label"),
    cls: "vc-pill",
    advice: t("bare.advice"),
  };
}

export function vigorIndexFromNdvi(meanNdvi: number): number {
  return Math.round(Math.min(100, Math.max(0, meanNdvi * 100)));
}
