import { FarmerCard } from "../FarmerCard";

import { getProducerBundle } from "./_producer";

/**
 * Aside producer identity card. Shares the cache()-memoised producer bundle
 * with <ProducerReviews>, so both stream from a single fetch.
 */
export async function ProducerCard({ farmerId }: { farmerId: string }) {
  const { farmer } = await getProducerBundle(farmerId);
  return farmer ? <FarmerCard farmer={farmer} /> : null;
}
