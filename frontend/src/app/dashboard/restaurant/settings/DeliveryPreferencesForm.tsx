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

const DAYS = [
  { v: "any", l: "Indifférent" },
  { v: "monday", l: "Lundi" },
  { v: "tuesday", l: "Mardi" },
  { v: "wednesday", l: "Mercredi" },
  { v: "thursday", l: "Jeudi" },
  { v: "friday", l: "Vendredi" },
  { v: "saturday", l: "Samedi" },
];

export function DeliveryPreferencesForm({
  regions,
}: {
  regions: readonly string[];
}) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [saved, setSaved] = useState(false);

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
          Région de livraison par défaut
        </label>
        <select
          id="default_region"
          value={prefs.default_region}
          onChange={(e) => update("default_region", e.target.value)}
          className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
        >
          <option value="">— Aucune —</option>
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
          Jour de livraison préféré
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
          Notes de livraison par défaut
        </label>
        <textarea
          id="default_notes"
          rows={3}
          maxLength={500}
          value={prefs.default_notes}
          onChange={(e) => update("default_notes", e.target.value)}
          placeholder="Préférences horaires, accès logistique, contact réception… (ne mentionnez aucune information confidentielle)"
          className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
        />
        <p className="mt-1 text-[11px] text-neutral-400">
          Ces notes pré-remplissent le panier mais peuvent être ajustées
          commande par commande.
        </p>
      </div>

      <div className="sm:col-span-2 flex items-center justify-end gap-3">
        {saved && (
          <span className="text-xs text-leaf-700">✓ Préférences enregistrées</span>
        )}
        <button type="submit" className="vc-btn-primary">
          Enregistrer
        </button>
      </div>
    </form>
  );
}
