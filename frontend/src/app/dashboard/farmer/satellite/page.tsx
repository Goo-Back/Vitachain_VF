import Link from "next/link";

import { fetchMyParcels } from "../parcels/actions";
import {
  InfoIcon,
  LeafIcon,
  MapPinIcon,
  SproutIcon,
} from "../_ui/Icon";
import { PageHeader } from "../_ui/PageHeader";

import { fetchNdviForParcel } from "./actions";

/**
 * Satellite · /dashboard/farmer/satellite?parcel=<id>
 *
 * Reads from GET /api/v1/katara/parcels/{id}/ndvi — the backend handles
 * Sentinel Hub auth + caching. No API keys live in this surface.
 *
 * V1 scope: latest cloud-free composite tile + mean NDVI + acquisition
 * date. The 6-month monthly series was cut from this iteration because
 * the backend Statistical-API helper isn't shipped yet; the existing
 * fetch_ndvi() helper only returns the latest mean.
 */

export const dynamic = "force-dynamic";

function bandFor(mean: number): { label: string; cls: string; advice: string } {
  if (mean >= 0.6) {
    return {
      label: "Très dense",
      cls: "vc-pill-ok",
      advice: "Couvert végétal vigoureux — surveillance routine.",
    };
  }
  if (mean >= 0.4) {
    return {
      label: "Dense",
      cls: "vc-pill-ok",
      advice: "Vigueur correcte pour la saison.",
    };
  }
  if (mean >= 0.2) {
    return {
      label: "Modéré",
      cls: "vc-pill-warn",
      advice:
        "Couvert plus faible que prévu — vérifier l'irrigation et la fertilisation.",
    };
  }
  if (mean >= 0) {
    return {
      label: "Faible / stressé",
      cls: "vc-pill-warn",
      advice:
        "Stress hydrique ou levée tardive probable — croiser avec les capteurs.",
    };
  }
  return {
    label: "Sol nu / eau",
    cls: "vc-pill",
    advice: "Aucune végétation détectée sur la parcelle.",
  };
}

export default async function SatellitePage({
  searchParams,
}: {
  searchParams: Promise<{ parcel?: string }>;
}) {
  const sp = await searchParams;
  const parcels = await fetchMyParcels();
  const selectedParcel = sp.parcel
    ? (parcels.find((p) => p.id === sp.parcel) ?? null)
    : (parcels[0] ?? null);

  const data = selectedParcel
    ? await fetchNdviForParcel(selectedParcel.id)
    : null;

  return (
    <div className="mx-auto max-w-5xl vc-fade-in">
      <PageHeader
        crumbs={[
          { label: "Mon exploitation", href: "/dashboard/farmer" },
          { label: "Satellite" },
        ]}
        eyebrow="Imagerie satellite"
        title="Vue Sentinel-2 & vigueur végétative."
        subtitle="Indice NDVI calculé sur l'image Sentinel-2 la plus récente sans nuages, clippé au polygone de la parcelle. Cache backend 12 h."
        actions={
          selectedParcel ? (
            <span className="vc-pill vc-pill-leaf">
              <MapPinIcon size={12} /> {selectedParcel.name}
            </span>
          ) : null
        }
      />

      <ParcelPicker
        parcels={parcels}
        selectedId={selectedParcel?.id ?? null}
      />

      {parcels.length === 0 ? (
        <NoParcelsPanel />
      ) : !data ? (
        <UnavailablePanel />
      ) : (
        <SatelliteView data={data} />
      )}
    </div>
  );
}

function ParcelPicker({
  parcels,
  selectedId,
}: {
  parcels: { id: string; name: string; crop_type: string }[];
  selectedId: string | null;
}) {
  if (parcels.length === 0) return null;
  return (
    <nav
      aria-label="Choix de la parcelle"
      className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white p-2 shadow-soft"
    >
      <span className="px-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
        Parcelle
      </span>
      {parcels.map((p) => {
        const active = p.id === selectedId;
        return (
          <Link
            key={p.id}
            href={`/dashboard/farmer/satellite?parcel=${p.id}`}
            scroll={false}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              active
                ? "bg-leaf-700 text-white shadow-sm"
                : "text-neutral-600 hover:bg-neutral-100"
            }`}
          >
            {p.name}
            <span className={`ml-1 ${active ? "text-white/70" : "text-neutral-400"}`}>
              · {p.crop_type}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function SatelliteView({
  data,
}: {
  data: NonNullable<Awaited<ReturnType<typeof fetchNdviForParcel>>>;
}) {
  const band = bandFor(data.mean_ndvi);
  const acquisitionLabel = new Date(data.acquisition_date).toLocaleDateString(
    "fr-FR",
    { day: "numeric", month: "long", year: "numeric" },
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="vc-card overflow-hidden">
        <div className="relative aspect-square w-full bg-neutral-100">
          {data.image_data_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.image_data_url}
              alt="Tuile NDVI Sentinel-2 clippée à la parcelle"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="grid h-full place-items-center px-6 text-center text-sm text-neutral-500">
              Image NDVI indisponible pour cette période. La moyenne reste
              calculée à partir du dernier composite cloud-free.
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 px-4 py-3 text-xs text-neutral-600">
          <span className="inline-flex items-center gap-1.5">
            <LeafIcon size={14} className="text-leaf-600" />
            Acquisition · {acquisitionLabel}
          </span>
          <span>Sentinel-2 L2A · Sentinel Hub</span>
        </div>
      </div>

      <div className="space-y-4">
        <div className="vc-card p-5">
          <p className="vc-eyebrow">NDVI moyen sur la parcelle</p>
          <p className="mt-2 text-5xl font-semibold tabular text-neutral-900">
            {data.mean_ndvi.toFixed(2)}
          </p>
          <span className={`vc-pill mt-3 ${band.cls}`}>{band.label}</span>
          <p className="mt-3 text-sm text-neutral-700">{band.advice}</p>
        </div>

        <div className="vc-card p-5">
          <p className="vc-eyebrow">Lecture de la carte NDVI</p>
          <ul className="mt-3 space-y-2 text-sm">
            <LegendRow swatch="bg-[#2e8530]" label="Très dense (NDVI ≥ 0.6)" />
            <LegendRow swatch="bg-[#6dc14d]" label="Dense (0.4 – 0.6)" />
            <LegendRow swatch="bg-[#c8db6b]" label="Modéré (0.2 – 0.4)" />
            <LegendRow swatch="bg-[#edd98c]" label="Faible / stressé (0 – 0.2)" />
            <LegendRow swatch="bg-[#a98c59]" label="Sol nu / eau (< 0)" />
          </ul>
        </div>
      </div>
    </div>
  );
}

function LegendRow({ swatch, label }: { swatch: string; label: string }) {
  return (
    <li className="flex items-center gap-2 text-neutral-700">
      <span className={`inline-block h-3 w-6 rounded ${swatch}`} />
      {label}
    </li>
  );
}

function NoParcelsPanel() {
  return (
    <div className="vc-card flex items-start gap-4 p-6">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-leaf-50 text-leaf-700">
        <SproutIcon size={20} />
      </span>
      <div>
        <p className="text-sm font-semibold text-neutral-900">
          Aucune parcelle à afficher
        </p>
        <p className="mt-1 text-sm text-neutral-600">
          Créez une parcelle avec son polygone GeoJSON pour activer
          l&apos;imagerie satellite.
        </p>
        <Link
          href="/dashboard/farmer/parcels/new"
          className="vc-btn-primary mt-3"
        >
          Créer une parcelle
        </Link>
      </div>
    </div>
  );
}

function UnavailablePanel() {
  return (
    <div className="vc-card flex items-start gap-4 p-6">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-warn-50 text-warn-700">
        <InfoIcon size={20} />
      </span>
      <div>
        <p className="text-sm font-semibold text-neutral-900">
          Données satellite indisponibles
        </p>
        <p className="mt-1 text-sm text-neutral-600">
          Aucune image Sentinel-2 cloud-free n&apos;a été trouvée sur la
          période, le backend n&apos;est pas joignable, ou la clé Sentinel Hub
          n&apos;est pas configurée côté serveur (variable d&apos;env{" "}
          <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs font-mono">
            SENTINEL_HUB_API_KEY
          </code>
          ). Les données Sentinel-2 sont mises à jour environ tous les 5 jours.
        </p>
      </div>
    </div>
  );
}
