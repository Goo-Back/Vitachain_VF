import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { toIntlLocale } from "@/lib/intlLocale";
import { PageHeader } from "@/app/[locale]/dashboard/farmer/_ui/PageHeader";
import {
  MapPinIcon,
  PackageIcon,
  SparkleIcon,
  TagIcon,
} from "@/app/[locale]/dashboard/farmer/_ui/Icon";
import { fetchAdById } from "@/app/[locale]/dashboard/restaurant/marketplace/actions";
import { PhotoGallery } from "@/app/[locale]/dashboard/restaurant/marketplace/[id]/PhotoGallery";

import { ProducerCard, ProducerReviews } from "./ProducerSection";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function CitizenAdDetailPage({ params }: Props) {
  const t = await getTranslations("citizen.adDetail");
  const intlLocale = toIntlLocale(await getLocale());
  const { id } = await params;
  const ad = await fetchAdById(id);
  if (!ad) notFound();

  const price = Number(ad.price_mad).toFixed(2);
  const qty = Number(ad.quantity_kg).toFixed(0);
  const expires = new Date(ad.expires_at).toLocaleDateString(intlLocale, {
    day: "numeric",
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
          { label: ad.title },
        ]}
        eyebrow="FarMarket"
        title={ad.title}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <PhotoGallery photos={ad.photo_urls} alt={ad.title} />

          <div className="vc-card mt-6 p-5">
            <h2 className="text-sm font-semibold text-neutral-900">
              {t("description")}
            </h2>
            <p className="mt-2 whitespace-pre-line text-sm text-neutral-700">
              {ad.description || t("noDescription")}
            </p>
          </div>

          <Suspense
            fallback={
              <div className="vc-card mt-6 p-5" aria-busy="true">
                <div className="vc-skeleton h-5 w-48" />
                <div className="vc-skeleton mt-4 h-24 w-full" />
              </div>
            }
          >
            <ProducerReviews adId={ad.id} farmerId={ad.farmer_id} />
          </Suspense>
        </section>

        <aside className="space-y-4">
          <div className="vc-card p-5">
            {ad.is_featured && (
              <span className="mb-3 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                <SparkleIcon size={12} /> {t("featured")}
              </span>
            )}

            <p className="text-3xl font-bold text-leaf-700">
              {price}{" "}
              <span className="text-sm font-normal text-neutral-500">
                MAD/kg
              </span>
            </p>

            <dl className="mt-4 space-y-3 text-sm">
              <Row
                icon={<TagIcon size={14} className="text-neutral-400" />}
                label={t("productType")}
                value={ad.product_type}
              />
              <Row
                icon={<PackageIcon size={14} className="text-neutral-400" />}
                label={t("stock")}
                value={t("stockValue", { qty })}
              />
              <Row
                icon={<MapPinIcon size={14} className="text-neutral-400" />}
                label={t("region")}
                value={ad.region}
              />
            </dl>

            <p className="mt-3 text-[11px] text-neutral-400">
              {t("validUntil", { date: expires })}
            </p>
          </div>

          <Suspense
            fallback={<div className="vc-skeleton h-40 w-full" aria-busy="true" />}
          >
            <ProducerCard farmerId={ad.farmer_id} />
          </Suspense>

          <div className="rounded-lg border border-leaf-100 bg-leaf-50/60 p-4 text-xs text-leaf-800">
            <p className="font-semibold">{t("howToOrderTitle")}</p>
            <p className="mt-1 text-leaf-700">{t("howToOrderBody")}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="flex items-center gap-2 text-neutral-500">
        {icon} {label}
      </dt>
      <dd className="text-right font-medium text-neutral-900">{value}</dd>
    </div>
  );
}
