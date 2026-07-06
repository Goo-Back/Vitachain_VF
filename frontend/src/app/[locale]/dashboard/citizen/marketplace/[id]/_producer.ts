import { cache } from "react";

import {
  fetchFarmerAds,
  fetchFarmerProfile,
  fetchFarmerRatings,
} from "@/app/[locale]/dashboard/restaurant/marketplace/actions";

/**
 * Producer-identity bundle for the citizen (read-only) ad detail page.
 * Skips fetchMyRating — rating is restaurant-only, so there's no "my rating"
 * to fetch here. Keyed on farmerId, cache()-memoised per request.
 */
export const getProducerBundle = cache(async (farmerId: string) => {
  const [farmer, farmerAds, reviews] = await Promise.all([
    fetchFarmerProfile(farmerId),
    fetchFarmerAds(farmerId),
    fetchFarmerRatings(farmerId),
  ]);
  return { farmer, farmerAds, reviews };
});
