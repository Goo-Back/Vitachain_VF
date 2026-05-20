import { ParcelCard } from "./ParcelCard";
import type { ParcelOverviewEntry } from "./overview-types";

export function ParcelGrid({ parcels }: { parcels: ParcelOverviewEntry[] }) {
  return (
    <section
      aria-label="Mes parcelles"
      className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
    >
      {parcels.map((p) => (
        <ParcelCard key={p.parcel_id} parcel={p} />
      ))}
    </section>
  );
}
