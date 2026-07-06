import { getTranslations } from "next-intl/server";

import { ParcelCard } from "./ParcelCard";
import { Stagger } from "./_ui/motion";
import type { ParcelOverviewEntry } from "./overview-types";

export async function ParcelGrid({
  parcels,
  vigorByParcel,
}: {
  parcels: ParcelOverviewEntry[];
  /** Vigor Index (NDVI mean × 100) per parcel — see page.tsx's
   *  ParcelGridWithVigors wrapper for how it's computed. A parcel absent
   *  from the map (still loading) simply renders without the badge. */
  vigorByParcel?: Record<string, number | null>;
}) {
  const t = await getTranslations("farmer.overview.parcelGrid");
  return (
    <Stagger
      as="section"
      ariaLabel={t("ariaLabel")}
      className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
    >
      {parcels.map((p) => (
        <ParcelCard
          key={p.parcel_id}
          parcel={p}
          vigorIndex={vigorByParcel?.[p.parcel_id]}
        />
      ))}
    </Stagger>
  );
}
