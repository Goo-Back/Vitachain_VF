import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

import { InfoIcon, SatelliteIcon } from "./_ui/Icon";
import { bandFor } from "./ndvi-format";
import type { NdviResponse } from "./satellite/actions";

/**
 * "Spatial Mapping — Live Satellite" preview card for the overview page.
 *
 * Async server component rendered inside a <Suspense> boundary by page.tsx
 * so a slow/cold Sentinel Hub image fetch never blocks the rest of the
 * dashboard. Every parcel's NDVI promise is created once in page.tsx and
 * shared with ParcelGrid's Vigor Index badges — this component only awaits
 * them, it never re-fetches, so the farm's Sentinel Hub calls stay at one
 * per parcel regardless of how many surfaces render NDVI.
 */
export async function SatelliteCard({
  parcels,
}: {
  parcels: { id: string; name: string; ndvi: Promise<NdviResponse | null> }[];
}) {
  const t = await getTranslations("farmer.overview.satelliteCard");
  const tBands = await getTranslations("farmer.common.ndviBands");
  const resolved = await Promise.all(
    parcels.map(async (p) => ({
      id: p.id,
      name: p.name,
      // The shared promise can reject for reasons fetchNdviForParcel itself
      // doesn't guard (e.g. the Supabase session read throwing before its
      // own try/catch is reached). Swallow per-parcel so one broken parcel
      // never blanks the whole strip.
      data: await p.ndvi.catch(() => null as NdviResponse | null),
    })),
  );

  return (
    <div className="katara-card flex h-full flex-col overflow-hidden p-0">
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-neutral-900">
          <SatelliteIcon size={16} />
          {t("title")}
        </h3>
        <Link
          href="/dashboard/farmer/satellite"
          className="text-xs font-semibold text-leaf-700 hover:underline"
        >
          {t("viewAll")}
        </Link>
      </div>

      <div className="flex-1 overflow-x-auto px-5 pb-5">
        <div className="flex gap-3">
          {resolved.map((p) => (
            <Link
              key={p.id}
              href={`/dashboard/farmer/satellite?parcel=${p.id}`}
              className="group w-[9.5rem] shrink-0 overflow-hidden rounded-xl border border-neutral-100 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="relative aspect-square w-full bg-neutral-100">
                {p.data?.image_data_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.data.image_data_url}
                    alt={t("altText", { name: p.name })}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="grid h-full place-items-center px-2 text-center">
                    <InfoIcon size={16} className="text-neutral-300" />
                  </div>
                )}
              </div>
              <div className="px-2.5 py-2">
                <p className="truncate text-xs font-semibold text-neutral-800">
                  {p.name}
                </p>
                {p.data ? (
                  <div className="mt-1 flex items-center justify-between gap-1">
                    <span className="text-sm font-bold tabular text-neutral-900">
                      {p.data.mean_ndvi.toFixed(2)}
                    </span>
                    <span className={`vc-pill px-1.5 py-0.5 text-[9px] ${bandFor(p.data.mean_ndvi, tBands).cls}`}>
                      {bandFor(p.data.mean_ndvi, tBands).label}
                    </span>
                  </div>
                ) : (
                  <p className="mt-1 text-[10px] text-neutral-400">{t("unavailable")}</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

export async function SatelliteCardSkeleton() {
  const t = await getTranslations("farmer.overview.satelliteCard");
  return (
    <div className="katara-card flex h-full flex-col overflow-hidden p-0">
      <div className="px-5 pt-5 pb-3">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-neutral-900">
          <SatelliteIcon size={16} />
          {t("title")}
        </h3>
      </div>
      <div className="flex gap-3 px-5 pb-5">
        <div className="vc-skeleton h-[9.5rem] w-[9.5rem] shrink-0 rounded-xl" />
        <div className="vc-skeleton h-[9.5rem] w-[9.5rem] shrink-0 rounded-xl" />
        <div className="vc-skeleton h-[9.5rem] w-[9.5rem] shrink-0 rounded-xl" />
      </div>
    </div>
  );
}
