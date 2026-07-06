import { getLocale, getTranslations } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";

import { getServerProfile } from "@/lib/auth/session";

import {
  ArrowRightIcon,
  CalendarIcon,
  ClockIcon,
  InfoIcon,
  PackageIcon,
  PlusIcon,
  StoreIcon,
  TagIcon,
} from "../_ui/Icon";
import { PageHeader } from "../_ui/PageHeader";
import { MotionCard, Stagger } from "../_ui/motion";
import { deleteAd, fetchMyAds, type Ad } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_CLASS: Record<Ad["status"], string> = {
  ACTIVE: "bg-leaf-50 text-leaf-700 ring-leaf-200",
  EXPIRED: "bg-neutral-100 text-neutral-500 ring-neutral-200",
  DELETED: "bg-danger-50 text-danger-700 ring-danger-500/30",
};

export default async function AdsPage() {
  const locale = await getLocale();
  const t = await getTranslations("farmer.ads.list");
  const tCommon = await getTranslations("farmer.common");
  const profile = await getServerProfile();
  if (profile?.role !== "FARMER") return redirect({ href: "/dashboard", locale });

  const isUnverified = profile.verification_status !== "VERIFIED";
  const ads = isUnverified ? [] : await fetchMyAds();

  return (
    <div className="mx-auto max-w-6xl vc-fade-in">
      <PageHeader
        crumbs={[
          { label: tCommon("breadcrumbHome"), href: "/dashboard/farmer" },
          { label: t("breadcrumb") },
        ]}
        eyebrow={t("eyebrow")}
        title={t("adsCount", { count: ads.length })}
        subtitle={
          isUnverified
            ? undefined
            : t("subtitle")
        }
        actions={
          isUnverified ? undefined : (
            <Link href="/dashboard/farmer/ads/new" className="vc-btn-primary">
              <PlusIcon size={14} /> {t("newAd")}
            </Link>
          )
        }
      />

      {isUnverified ? (
        <UnverifiedNotice />
      ) : ads.length === 0 ? (
        <EmptyState />
      ) : (
        <Stagger as="ul" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ads.map((ad) => (
            <AdCard key={ad.id} ad={ad} />
          ))}
        </Stagger>
      )}
    </div>
  );
}

async function UnverifiedNotice() {
  const t = await getTranslations("farmer.ads.list");
  return (
    <div className="vc-card flex items-start gap-4 border-warn-500/30 bg-warn-50/60 p-5">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-warn-50 text-warn-700">
        <InfoIcon size={20} />
      </span>
      <div className="flex-1">
        <p className="text-sm font-semibold text-warn-700">
          {t("unverifiedTitle")}
        </p>
        <p className="mt-1 text-sm text-neutral-700">
          {t("unverifiedBody")}
        </p>
        <Link href="/onboarding/verification" className="vc-btn-primary mt-3">
          {t("submitDocuments")} <ArrowRightIcon size={14} className="rtl:-scale-x-100" />
        </Link>
      </div>
    </div>
  );
}

async function EmptyState() {
  const t = await getTranslations("farmer.ads.list");
  return (
    <div className="vc-card p-10 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-leaf-50">
        <StoreIcon size={28} className="text-leaf-700" />
      </span>
      <p className="mt-4 text-base font-semibold text-neutral-900">
        {t("emptyTitle")}
      </p>
      <p className="mt-1 text-sm text-neutral-500">
        {t("emptyBody")}
      </p>
      <Link href="/dashboard/farmer/ads/new" className="vc-btn-primary mt-5">
        <PlusIcon size={14} /> {t("createAd")}
      </Link>
    </div>
  );
}

async function AdCard({ ad }: { ad: Ad }) {
  const t = await getTranslations("farmer.ads.list");
  const expiresAt = new Date(ad.expires_at);
  const now = new Date();
  const daysLeft = Math.ceil(
    (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );

  return (
    <MotionCard as="li" interactive={false} className="h-full">
      <div className="katara-card group relative flex h-full flex-col overflow-hidden p-0">
        <span aria-hidden="true" className="katara-glow" />

        <div className="relative">
          {ad.photo_urls[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={ad.photo_urls[0]}
              alt={ad.title}
              className="h-40 w-full object-cover"
            />
          ) : (
            <div className="flex h-40 w-full items-center justify-center bg-leaf-50">
              <PackageIcon size={32} className="text-leaf-700" />
            </div>
          )}
          <div className="absolute start-2 top-2">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_CLASS[ad.status]}`}
            >
              {t(`status.${ad.status}`)}
            </span>
          </div>
        </div>

        <div className="relative flex flex-1 flex-col p-5">
          <p className="truncate text-base font-semibold text-neutral-900">
            {ad.title}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-leaf-700">
            <TagIcon size={12} className="text-leaf-600" />
            {ad.product_type} · {ad.region}
          </p>

          <div className="mt-3 flex items-end justify-between gap-2">
            <p className="text-lg font-bold text-leaf-700">
              {Number(ad.price_mad).toFixed(2)}{" "}
              <span className="text-xs font-normal text-neutral-400">MAD/kg</span>
            </p>
            <div className="text-right">
              <p className="text-[0.65rem] font-medium uppercase tracking-wide text-neutral-400">
                {t("available")}
              </p>
              <p className="flex items-center gap-1 text-xs font-semibold text-neutral-700">
                <PackageIcon size={12} />
                {Number(ad.quantity_kg).toFixed(0)} kg
              </p>
            </div>
          </div>

          {ad.status === "ACTIVE" && daysLeft > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-neutral-400">
              <ClockIcon size={12} />
              {t("expiresIn", { count: daysLeft })}
            </p>
          )}
          {ad.status === "ACTIVE" && daysLeft <= 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-neutral-400">
              <CalendarIcon size={12} />
              {t("expiresToday")}
            </p>
          )}

          {ad.status === "ACTIVE" && (
            <div className="mt-auto flex items-center gap-2 border-t border-neutral-100 pt-4">
              <Link
                href={`/dashboard/farmer/ads/${ad.id}/edit`}
                className="vc-btn-ghost flex-1 py-1.5 text-xs"
              >
                {t("edit")}
              </Link>
              <form
                action={async () => {
                  "use server";
                  await deleteAd(ad.id);
                }}
                className="flex-1"
              >
                <button
                  type="submit"
                  className="w-full rounded-lg px-3 py-1.5 text-xs font-medium text-danger-700 ring-1 ring-danger-500/30 transition-colors hover:bg-danger-50"
                >
                  {t("delete")}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </MotionCard>
  );
}
