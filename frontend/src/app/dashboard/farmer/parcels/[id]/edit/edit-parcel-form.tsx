"use client";

import { useActionState, useState, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";

import { submitUpdateParcelForm, type Parcel } from "../../actions";

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

const ALL_CROP_VALUES = CROPS.flatMap((g) => g.items);

const ERROR_COPY: Record<string, string> = {
  name_required: "Le nom de la parcelle est obligatoire.",
  crop_type_required: "Le type de culture est obligatoire.",
  surface_area_invalid: "La surface doit être un nombre strictement positif.",
  geojson_syntax: "Polygone invalide — tracez au moins 3 points sur la carte.",
  network_error: "Erreur réseau. Vérifiez votre connexion et réessayez.",
  parcel_create_failed: "Mise à jour échouée côté serveur. Réessayez.",
};

type LatLng = [number, number];

function toGeoJSON(points: LatLng[]): string {
  const first = points[0];
  if (points.length < 3 || !first) return "";
  const ring = [...points, first].map(([lat, lng]) => [lng, lat]);
  return JSON.stringify({ type: "Polygon", coordinates: [ring] });
}

function pointsFromGeoJSON(geojson: Record<string, unknown>): LatLng[] {
  try {
    let coords: number[][];
    if (geojson.type === "Polygon") {
      coords = ((geojson.coordinates as number[][][])[0] ?? []).slice(0, -1);
    } else if (geojson.type === "Feature") {
      const geom = geojson.geometry as { coordinates: number[][][] };
      coords = (geom.coordinates[0] ?? []).slice(0, -1);
    } else {
      return [];
    }
    return coords.map(([lng, lat]) => [lat ?? 0, lng ?? 0] as LatLng);
  } catch {
    return [];
  }
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

function errorMessage(code: string): string {
  return ERROR_COPY[code] ?? `Erreur inattendue (${code}). Réessayez.`;
}

export function EditParcelForm({ parcel }: { parcel: Parcel }) {
  const boundAction = useMemo(
    () => submitUpdateParcelForm.bind(null, parcel.id),
    [parcel.id],
  );
  const [state, formAction, pending] = useActionState(boundAction, {
    error: null as string | null,
  });

  const initialCrop = ALL_CROP_VALUES.includes(parcel.crop_type)
    ? parcel.crop_type
    : "__autre__";
  const [cropType, setCropType] = useState(initialCrop);
  const [customCrop, setCustomCrop] = useState(
    initialCrop === "__autre__" ? parcel.crop_type : "",
  );
  const [surfaceArea, setSurfaceArea] = useState(
    Number(parcel.surface_area_ha).toFixed(4),
  );
  const [points, setPoints] = useState<LatLng[]>(
    () => pointsFromGeoJSON(parcel.geojson),
  );

  const handleChange = useCallback((pts: LatLng[]) => setPoints(pts), []);
  const geojson = toGeoJSON(points);

  const initialCenter = useMemo((): LatLng | undefined => {
    if (points.length === 0) return undefined;
    const lat = points.reduce((s, p) => s + p[0], 0) / points.length;
    const lng = points.reduce((s, p) => s + p[1], 0) / points.length;
    return [lat, lng];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // computed once from initial points — map center doesn't track later edits

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
          Nom de la parcelle
        </label>
        <input
          id="name"
          name="name"
          type="text"
          defaultValue={parcel.name}
          placeholder="Parcelle Nord"
          required
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
      </div>

      {/* Type de culture */}
      <div>
        <label htmlFor="crop_type" className="mb-1 block text-sm font-medium text-neutral-800">
          Type de culture
        </label>
        <select
          id="crop_type"
          name="crop_type"
          value={cropType}
          onChange={(e) => setCropType(e.target.value)}
          required
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        >
          <option value="">— Choisir un type de culture —</option>
          {CROPS.map((group) => (
            <optgroup key={group.group} label={group.group}>
              {group.items.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </optgroup>
          ))}
          <option value="__autre__">Autre (préciser)</option>
        </select>
        {cropType === "__autre__" && (
          <input
            type="text"
            name="crop_type_custom"
            value={customCrop}
            onChange={(e) => setCustomCrop(e.target.value)}
            placeholder="Précisez le type de culture…"
            required
            className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        )}
      </div>

      {/* Surface */}
      <div>
        <label htmlFor="surface_area_ha" className="mb-1 block text-sm font-medium text-neutral-800">
          Surface (hectares)
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
            ⟳ Calculer depuis le polygone (~{approxAreaHa(points).toFixed(2)} ha)
          </button>
        )}
      </div>

      {/* Carte */}
      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-800">
          Délimitez votre parcelle
        </label>
        <p className="mb-2 text-xs text-neutral-500">
          Cliquez sur la carte pour repositionner les sommets. Minimum 3 points.
        </p>

        <PolygonMapPicker
          points={points}
          onChange={handleChange}
          initialCenter={initialCenter}
          initialZoom={initialCenter ? 13 : 8}
        />

        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPoints((p) => p.slice(0, -1))}
            disabled={points.length === 0}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ↩ Annuler le dernier point
          </button>
          <button
            type="button"
            onClick={() => setPoints([])}
            disabled={points.length === 0}
            className="rounded-md border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Réinitialiser
          </button>
          <span className="ml-auto text-xs text-neutral-500">
            {points.length} point{points.length !== 1 ? "s" : ""}
            {points.length === 0
              ? " — cliquez sur la carte"
              : points.length < 3
                ? ` — encore ${3 - points.length} pour tracer`
                : " ✓ polygone prêt"}
          </span>
        </div>

        <input type="hidden" name="geojson" value={geojson} />
      </div>

      <button
        type="submit"
        disabled={pending || points.length < 3}
        className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Enregistrement…" : "Enregistrer les modifications"}
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
