"use client";

import { useActionState, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";

import { submitParcelForm } from "../actions";

const PolygonMapPicker = dynamic(
  () => import("@/components/PolygonMapPicker"),
  { ssr: false, loading: () => <MapSkeleton /> },
);

const CROPS = [
  { group: "Céréales", items: ["Blé tendre", "Blé dur", "Orge", "Maïs", "Sorgho"] },
  {
    group: "Légumes fruits",
    items: ["Tomates", "Poivrons", "Piments", "Aubergines", "Courgettes", "Concombres"],
  },
  {
    group: "Légumes racines",
    items: ["Pommes de terre", "Oignons", "Ail", "Carottes", "Betteraves"],
  },
  {
    group: "Légumes feuilles",
    items: ["Laitue", "Épinards", "Persil", "Coriandre"],
  },
  {
    group: "Arboriculture",
    items: ["Oliviers", "Agrumes", "Vignes", "Amandiers", "Figuiers"],
  },
  {
    group: "Autres cultures",
    items: ["Fraises", "Melons", "Pastèques", "Tournesol"],
  },
];

const ERROR_KEYS = new Set([
  "name_required",
  "crop_type_required",
  "surface_area_invalid",
  "geojson_syntax",
  "verification_required",
  "role_not_allowed",
  "parcel_create_failed",
]);

type LatLng = [number, number];

function toGeoJSON(points: LatLng[]): string {
  const first = points[0];
  if (points.length < 3 || !first) return "";
  const ring = [...points, first].map(([lat, lng]) => [lng, lat]);
  return JSON.stringify({ type: "Polygon", coordinates: [ring] });
}

function approxAreaHa(points: LatLng[]): number {
  const n = points.length;
  if (n < 3) return 0;
  const centerLat = points.reduce((s, p) => s + (p[0] ?? 0), 0) / n;
  const mPerLat = 111_320;
  const mPerLng = 111_320 * Math.cos((centerLat * Math.PI) / 180);
  let shoelace = 0;
  for (let i = 0; i < n; i++) {
    const p1 = points[i]!;
    const p2 = points[(i + 1) % n]!;
    shoelace += p1[1] * p2[0] - p2[1] * p1[0];
  }
  return (Math.abs(shoelace / 2) * mPerLng * mPerLat) / 10_000;
}

export function NewParcelForm() {
  const t = useTranslations("farmer.parcels.new.form");
  const [state, formAction, pending] = useActionState(submitParcelForm, {
    error: null as string | null,
  });
  const [cropType, setCropType] = useState("");
  const [customCrop, setCustomCrop] = useState("");
  const [surfaceArea, setSurfaceArea] = useState("");
  const [points, setPoints] = useState<LatLng[]>([]);

  const handleChange = useCallback((pts: LatLng[]) => setPoints(pts), []);
  const geojson = toGeoJSON(points);

  function errorMessage(code: string): string {
    return ERROR_KEYS.has(code) ? t(`errors.${code}`) : t("errors.unexpected", { code });
  }

  return (
    <form action={formAction} className="space-y-5">
      {state.error && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {errorMessage(state.error)}
        </div>
      )}

      {/* Nom */}
      <div>
        <label htmlFor="name" className="mb-1 block text-sm font-medium text-neutral-800">
          {t("nameLabel")}
        </label>
        <input
          id="name"
          name="name"
          type="text"
          placeholder={t("namePlaceholder")}
          required
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
      </div>

      {/* Type de culture */}
      <div>
        <label htmlFor="crop_type" className="mb-1 block text-sm font-medium text-neutral-800">
          {t("cropTypeLabel")}
        </label>
        <select
          id="crop_type"
          name="crop_type"
          value={cropType}
          onChange={(e) => setCropType(e.target.value)}
          required
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        >
          <option value="">{t("cropTypePlaceholder")}</option>
          {CROPS.map((group) => (
            <optgroup key={group.group} label={group.group}>
              {group.items.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </optgroup>
          ))}
          <option value="__autre__">{t("cropTypeOther")}</option>
        </select>
        {cropType === "__autre__" && (
          <input
            type="text"
            name="crop_type_custom"
            value={customCrop}
            onChange={(e) => setCustomCrop(e.target.value)}
            placeholder={t("cropTypeOtherPlaceholder")}
            required
            className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        )}
      </div>

      {/* Surface */}
      <div>
        <label htmlFor="surface_area_ha" className="mb-1 block text-sm font-medium text-neutral-800">
          {t("surfaceLabel")}
        </label>
        <input
          id="surface_area_ha"
          name="surface_area_ha"
          type="number"
          step="0.0001"
          min="0.0001"
          placeholder="1.5"
          required
          value={surfaceArea}
          onChange={(e) => setSurfaceArea(e.target.value)}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        {points.length >= 3 && (
          <button
            type="button"
            onClick={() => setSurfaceArea(approxAreaHa(points).toFixed(4))}
            className="mt-1 text-xs text-emerald-700 hover:underline"
          >
            {t("computeFromPolygon", { value: approxAreaHa(points).toFixed(2) })}
          </button>
        )}
      </div>

      {/* Carte */}
      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-800">
          {t("delimitLabel")}
        </label>
        <p className="mb-2 text-xs text-neutral-500">
          {t("delimitHelp")}
        </p>

        <PolygonMapPicker points={points} onChange={handleChange} />

        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPoints((p) => p.slice(0, -1))}
            disabled={points.length === 0}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("undoPoint")}
          </button>
          <button
            type="button"
            onClick={() => setPoints([])}
            disabled={points.length === 0}
            className="rounded-md border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("reset")}
          </button>
          <span className="ml-auto text-xs text-neutral-500">
            {t("pointsCount", { count: points.length })}
            {points.length === 0
              ? t("clickMap")
              : points.length < 3
                ? t("morePointsNeeded", { count: 3 - points.length })
                : t("polygonReady")}
          </span>
        </div>

        <input type="hidden" name="geojson" value={geojson} />
      </div>

      <button
        type="submit"
        disabled={pending || points.length < 3}
        className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}

function MapSkeleton() {
  return (
    <div
      className="animate-pulse rounded-lg bg-neutral-100"
      style={{ height: "380px" }}
    />
  );
}
