import { ParcelCard } from "./ParcelCard";
import { Stagger } from "./_ui/motion";
import type { ParcelOverviewEntry } from "./overview-types";

export function ParcelGrid({ parcels }: { parcels: ParcelOverviewEntry[] }) {
  return (
    <Stagger
      as="section"
      ariaLabel="Mes parcelles"
      className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
    >
      {parcels.map((p) => (
        <ParcelCard key={p.parcel_id} parcel={p} />
      ))}
    </Stagger>
  );
}
