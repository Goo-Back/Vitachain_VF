import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

import { fetchMyParcels } from "../parcels/actions";
import { MapPinIcon, SproutIcon } from "../_ui/Icon";
import { PageHeader } from "../_ui/PageHeader";

import { fetchNdviForParcel } from "./actions";
import { SatelliteUnavailablePanel, SatelliteView } from "./SatellitePanel";

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

export default async function SatellitePage({
  searchParams,
}: {
  searchParams: Promise<{ parcel?: string }>;
}) {
  const t = await getTranslations("farmer.satellite.page");
  const tCommon = await getTranslations("farmer.common");
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
          { label: tCommon("breadcrumbHome"), href: "/dashboard/farmer" },
          { label: t("breadcrumb") },
        ]}
        eyebrow={t("eyebrow")}
        title={t("title")}
        subtitle={t("subtitle")}
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
        <SatelliteUnavailablePanel />
      ) : (
        <SatelliteView
          data={data}
          parcelMeta={{
            cropType: selectedParcel!.crop_type,
            surfaceAreaHa: Number(selectedParcel!.surface_area_ha),
          }}
        />
      )}
    </div>
  );
}

async function ParcelPicker({
  parcels,
  selectedId,
}: {
  parcels: { id: string; name: string; crop_type: string }[];
  selectedId: string | null;
}) {
  const t = await getTranslations("farmer.satellite.page");
  if (parcels.length === 0) return null;
  return (
    <nav
      aria-label={t("parcelPickerAriaLabel")}
      className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white p-2 shadow-soft"
    >
      <span className="px-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
        {t("parcelLabel")}
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
            <span className={`ms-1 ${active ? "text-white/70" : "text-neutral-400"}`}>
              · {p.crop_type}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

async function NoParcelsPanel() {
  const t = await getTranslations("farmer.satellite.page");
  return (
    <div className="vc-card flex items-start gap-4 p-6">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-leaf-50 text-leaf-700">
        <SproutIcon size={20} />
      </span>
      <div>
        <p className="text-sm font-semibold text-neutral-900">
          {t("noParcelsTitle")}
        </p>
        <p className="mt-1 text-sm text-neutral-600">
          {t("noParcelsBody")}
        </p>
        <Link
          href="/dashboard/farmer/parcels/new"
          className="vc-btn-primary mt-3"
        >
          {t("createParcel")}
        </Link>
      </div>
    </div>
  );
}
