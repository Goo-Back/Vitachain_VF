import { notFound } from "next/navigation";

import { PageHeader } from "@/app/dashboard/farmer/_ui/PageHeader";
import { CheckCircleIcon, MapPinIcon } from "@/app/dashboard/farmer/_ui/Icon";

import {
  fetchFarmerAds,
  fetchFarmerProfile,
  fetchFarmerRatings,
  fetchMyRating,
} from "../../actions";
import { AdCatalogCard } from "../../AdCatalogCard";
import { RatingForm } from "../../RatingForm";
import { ReviewList } from "../../ReviewList";
import { StarRating } from "../../StarRating";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ farmerId: string }> };

export default async function FarmerProfilePage({ params }: Props) {
  const { farmerId } = await params;

  const [farmer, ads, reviews, myRating] = await Promise.all([
    fetchFarmerProfile(farmerId),
    fetchFarmerAds(farmerId),
    fetchFarmerRatings(farmerId),
    fetchMyRating(farmerId),
  ]);
  if (!farmer) notFound();

  const memberSince = new Date(farmer.member_since).toLocaleDateString("fr-MA", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="vc-fade-in">
      <PageHeader
        crumbs={[
          { label: "Catalogue", href: "/dashboard/restaurant/marketplace" },
          { label: farmer.display_name },
        ]}
        eyebrow="Producteur"
        title={farmer.display_name}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <aside className="space-y-4">
          <div className="vc-card p-5">
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
              <CheckCircleIcon size={12} /> Producteur vérifié
            </span>
            <div className="mt-2">
              <StarRating value={farmer.rating_avg} count={farmer.rating_count} />
            </div>
            <dl className="mt-4 space-y-2 text-xs text-neutral-600">
              {farmer.region && (
                <div className="flex items-center gap-2">
                  <MapPinIcon size={14} className="text-neutral-400" />
                  <span>{farmer.region}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-neutral-400">Membre depuis</span>
                <span className="capitalize">{memberSince}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-neutral-400">Annonces actives</span>
                <span>{farmer.active_ad_count}</span>
              </div>
            </dl>
          </div>

          <RatingForm farmerId={farmer.id} initial={myRating} />
        </aside>

        <section className="lg:col-span-2 space-y-6">
          <div className="vc-card p-5">
            <h2 className="mb-4 text-sm font-semibold text-neutral-900">
              Annonces de ce producteur
            </h2>
            {ads.length === 0 ? (
              <p className="text-sm text-neutral-500">
                Aucune annonce active pour le moment.
              </p>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2">
                {ads.map((a) => (
                  <AdCatalogCard key={a.id} ad={a} />
                ))}
              </ul>
            )}
          </div>

          <div className="vc-card p-5">
            <h2 className="mb-4 text-sm font-semibold text-neutral-900">
              Avis des restaurants
            </h2>
            <ReviewList reviews={reviews} />
          </div>
        </section>
      </div>
    </div>
  );
}
