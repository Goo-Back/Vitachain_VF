import { getTranslations } from "next-intl/server";

import { ReviewList } from "@/app/[locale]/dashboard/restaurant/marketplace/ReviewList";
import { FarmerCard } from "@/app/[locale]/dashboard/restaurant/marketplace/FarmerCard";

import { AdCard } from "../AdCard";
import { getProducerBundle } from "./_producer";

export async function ProducerCard({ farmerId }: { farmerId: string }) {
  const { farmer } = await getProducerBundle(farmerId);
  return farmer ? (
    <FarmerCard farmer={farmer} basePath="/dashboard/citizen/marketplace" />
  ) : null;
}

export async function ProducerReviews({
  adId,
  farmerId,
}: {
  adId: string;
  farmerId: string;
}) {
  const t = await getTranslations("citizen.adDetail");
  const { farmerAds, reviews } = await getProducerBundle(farmerId);
  const otherAds = farmerAds.filter((a) => a.id !== adId);

  return (
    <>
      {otherAds.length > 0 && (
        <div className="vc-card mt-6 p-5">
          <h2 className="mb-4 text-sm font-semibold text-neutral-900">
            {t("otherAds")}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {otherAds.slice(0, 4).map((a) => (
              <AdCard key={a.id} ad={a} />
            ))}
          </ul>
        </div>
      )}

      <div className="vc-card mt-6 p-5">
        <h2 className="mb-4 text-sm font-semibold text-neutral-900">
          {t("reviews")}
        </h2>
        <ReviewList reviews={reviews} />
      </div>
    </>
  );
}
