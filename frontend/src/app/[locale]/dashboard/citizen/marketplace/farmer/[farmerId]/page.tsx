import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { toIntlLocale } from "@/lib/intlLocale";
import { PageHeader } from "@/app/[locale]/dashboard/farmer/_ui/PageHeader";
import { CheckCircleIcon, MapPinIcon } from "@/app/[locale]/dashboard/farmer/_ui/Icon";
import {
  fetchFarmerAds,
  fetchFarmerProfile,
  fetchFarmerRatings,
} from "@/app/[locale]/dashboard/restaurant/marketplace/actions";
import { ReviewList } from "@/app/[locale]/dashboard/restaurant/marketplace/ReviewList";
import { StarRating } from "@/app/[locale]/dashboard/restaurant/marketplace/StarRating";

import { AdCard } from "../../AdCard";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ farmerId: string }> };

export default async function CitizenFarmerProfilePage({ params }: Props) {
  const t = await getTranslations("citizen.farmerProfile");
  const intlLocale = toIntlLocale(await getLocale());
  const { farmerId } = await params;

  const [farmer, ads, reviews] = await Promise.all([
    fetchFarmerProfile(farmerId),
    fetchFarmerAds(farmerId),
    fetchFarmerRatings(farmerId),
  ]);
  if (!farmer) notFound();

  const memberSince = new Date(farmer.member_since).toLocaleDateString(intlLocale, {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="vc-fade-in">
      <PageHeader
        crumbs={[
          {
            label: t("breadcrumbCatalog"),
            href: "/dashboard/citizen/marketplace",
          },
          { label: farmer.display_name },
        ]}
        eyebrow={t("eyebrow")}
        title={farmer.display_name}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <aside className="space-y-4">
          <div className="vc-card p-5">
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
              <CheckCircleIcon size={12} /> {t("verified")}
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
                <span className="text-neutral-400">{t("memberSince")}</span>
                <span className="capitalize">{memberSince}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-neutral-400">{t("activeAds")}</span>
                <span>{farmer.active_ad_count}</span>
              </div>
            </dl>
          </div>
        </aside>

        <section className="lg:col-span-2 space-y-6">
          <div className="vc-card p-5">
            <h2 className="mb-4 text-sm font-semibold text-neutral-900">
              {t("adsTitle")}
            </h2>
            {ads.length === 0 ? (
              <p className="text-sm text-neutral-500">{t("noAds")}</p>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2">
                {ads.map((a) => (
                  <AdCard key={a.id} ad={a} />
                ))}
              </ul>
            )}
          </div>

          <div className="vc-card p-5">
            <h2 className="mb-4 text-sm font-semibold text-neutral-900">
              {t("reviewsTitle")}
            </h2>
            <ReviewList reviews={reviews} />
          </div>
        </section>
      </div>
    </div>
  );
}
