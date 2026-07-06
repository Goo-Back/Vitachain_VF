import { getTranslations } from "next-intl/server";

import { AdCatalogCard } from "../AdCatalogCard";
import { RatingForm } from "../RatingForm";
import { ReviewList } from "../ReviewList";

import { getProducerBundle } from "./_producer";

/**
 * Main-column producer sections (other ads + reviews), streamed below the
 * product card so they don't gate the price / photos / add-to-cart on the
 * four-call producer fan-out.
 */
export async function ProducerReviews({
  adId,
  farmerId,
}: {
  adId: string;
  farmerId: string;
}) {
  const t = await getTranslations("restaurant.marketplace.producerReviews");
  const { farmerAds, reviews, myRating } = await getProducerBundle(farmerId);
  const otherAds = farmerAds.filter((a) => a.id !== adId);

  return (
    <>
      {otherAds.length > 0 && (
        <div className="vc-card mt-6 p-5">
          <h2 className="mb-4 text-sm font-semibold text-neutral-900">
            {t("otherAdsTitle")}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {otherAds.slice(0, 4).map((a) => (
              <AdCatalogCard key={a.id} ad={a} />
            ))}
          </ul>
        </div>
      )}

      <div className="vc-card mt-6 p-5">
        <h2 className="mb-4 text-sm font-semibold text-neutral-900">
          {t("reviewsTitle")}
        </h2>
        <div className="mb-5">
          <RatingForm farmerId={farmerId} initial={myRating} />
        </div>
        <ReviewList reviews={reviews} />
      </div>
    </>
  );
}
