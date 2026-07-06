"use client";

/**
 * Client-side delivery preferences saved in localStorage.
 *
 * The cart page already reads `vita_delivery_prefs_v1` to pre-fill the
 * default region and notes. This isn't persisted to the backend yet — when
 * a delivery-prefs endpoint ships, swap the localStorage read/write for a
 * server action without touching the rest of the form.
 */

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

const STORAGE_KEY = "vita_delivery_prefs_v1";

type Prefs = {
  default_region: string;
  default_notes: string;
  preferred_day: string;
};

const DEFAULTS: Prefs = {
  default_region: "",
  default_notes: "",
  preferred_day: "any",
};

export function DeliveryPreferencesForm({
  regions,
}: {
  regions: readonly string[];
}) {
  const t = useTranslations("restaurant.settings.deliveryForm");
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [saved, setSaved] = useState(false);

  const DAYS = [
    { v: "any", l: t("dayAny") },
    { v: "monday", l: t("dayMonday") },
    { v: "tuesday", l: t("dayTuesday") },
    { v: "wednesday", l: t("dayWednesday") },
    { v: "thursday", l: t("dayThursday") },
    { v: "friday", l: t("dayFriday") },
    { v: "saturday", l: t("daySaturday") },
  ];

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Prefs>;
        setPrefs({ ...DEFAULTS, ...parsed });
      }
    } catch {
      // ignore
    }
  }, []);

  function update<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    setPrefs((p) => ({ ...p, [key]: value }));
    setSaved(false);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch {
      // ignore quota
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      <div>
        <label
          htmlFor="default_region"
          className="block text-xs font-medium text-neutral-600"
        >
          {t("defaultRegionLabel")}
        </label>
        <select
          id="default_region"
          value={prefs.default_region}
          onChange={(e) => update("default_region", e.target.value)}
          className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
        >
          <option value="">{t("noneOption")}</option>
          {regions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="preferred_day"
          className="block text-xs font-medium text-neutral-600"
        >
          {t("preferredDayLabel")}
        </label>
        <select
          id="preferred_day"
          value={prefs.preferred_day}
          onChange={(e) => update("preferred_day", e.target.value)}
          className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
        >
          {DAYS.map((d) => (
            <option key={d.v} value={d.v}>
              {d.l}
            </option>
          ))}
        </select>
      </div>

      <div className="sm:col-span-2">
        <label
          htmlFor="default_notes"
          className="block text-xs font-medium text-neutral-600"
        >
          {t("notesLabel")}
        </label>
        <textarea
          id="default_notes"
          rows={3}
          maxLength={500}
          value={prefs.default_notes}
          onChange={(e) => update("default_notes", e.target.value)}
          placeholder={t("notesPlaceholder")}
          className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
        />
        <p className="mt-1 text-[11px] text-neutral-400">
          {t("notesHint")}
        </p>
      </div>

      <div className="sm:col-span-2 flex items-center justify-end gap-3">
        {saved && (
          <span className="text-xs text-leaf-700">{t("saved")}</span>
        )}
        <button type="submit" className="vc-btn-primary">
          {t("save")}
        </button>
      </div>
    </form>
  );
}
