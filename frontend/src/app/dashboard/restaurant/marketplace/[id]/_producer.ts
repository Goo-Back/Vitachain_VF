import { cache } from "react";

import {
  fetchFarmerAds,
  fetchFarmerProfile,
  fetchFarmerRatings,
  fetchMyRating,
} from "../actions";

/**
 * The producer-identity bundle behind a parcel ad: profile, their other ads,
 * reviews, and the caller's own rating. Wrapped in React `cache()` so the two
 * Suspense boundaries that consume it (the reviews block in the main column and
 * the producer card in the aside) share a single fan-out fetch per request.
 *
 * Keyed on `farmerId`, so distinct producers don't collide.
 */
export const getProducerBundle = cache(async (farmerId: string) => {
  const [farmer, farmerAds, reviews, myRating] = await Promise.all([
    fetchFarmerProfile(farmerId),
    fetchFarmerAds(farmerId),
    fetchFarmerRatings(farmerId),
    fetchMyRating(farmerId),
  ]);
  return { farmer, farmerAds, reviews, myRating };
});
