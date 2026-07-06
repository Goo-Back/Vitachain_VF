import { getLocale, getTranslations } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";

import { getServerProfile } from "@/lib/auth/session";
import { toIntlLocale } from "@/lib/intlLocale";

import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  CalendarIcon,
  InfoIcon,
  LeafIcon,
  PlusIcon,
  SproutIcon,
} from "../_ui/Icon";

import { PageHeader } from "../_ui/PageHeader";
import { CardLink, Stagger, StaggerItem } from "../_ui/motion";

import { fetchMyParcels, type Parcel } from "./actions";

export const dynamic = "force-dynamic";

export default async function ParcelsPage() {
  const locale = await getLocale();
  const t = await getTranslations("farmer.parcels.list");
  const tCommon = await getTranslations("farmer.common");
  const tParcelsCommon = await getTranslations("farmer.parcels.common");
  const profile = await getServerProfile();
  if (profile?.role !== "FARMER") return redirect({ href: "/dashboard", locale });

  const isUnverified = profile.verification_status !== "VERIFIED";
  const parcels = isUnverified ? [] : await fetchMyParcels();

  return (
    <div className="mx-auto max-w-6xl vc-fade-in">
      <PageHeader
        crumbs={[{ label: tCommon("breadcrumbHome"), href: "/dashboard/farmer" }, { label: tParcelsCommon("breadcrumb") }]}
        eyebrow={tParcelsCommon("breadcrumb")}
        title={t("parcelsCount", { count: parcels.length })}
        subtitle={
          isUnverified
            ? undefined
            : t("subtitle")
        }
        actions={
          isUnverified ? undefined : (
            <Link href="/dashboard/farmer/parcels/new" className="vc-btn-primary">
              <PlusIcon size={14} /> {t("newParcel")}
            </Link>
          )
        }
      />

      {isUnverified ? (
        <UnverifiedNotice />
      ) : parcels.length === 0 ? (
        <EmptyState />
      ) : (
        <Stagger as="ul" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {parcels.map((p) => (
            <StaggerItem key={p.id} as="li" className="h-full">
              <ParcelListItem parcel={p} />
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  );
}

async function UnverifiedNotice() {
  const t = await getTranslations("farmer.parcels.list");
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
        <Link
          href="/onboarding/verification"
          className="vc-btn-primary mt-3"
        >
          {t("submitDocuments")} <ArrowRightIcon size={14} className="rtl:-scale-x-100" />
        </Link>
      </div>
    </div>
  );
}

async function EmptyState() {
  const t = await getTranslations("farmer.parcels.list");
  return (
    <div className="vc-card p-10 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-leaf-50">
        <SproutIcon size={28} className="text-leaf-700" />
      </span>
      <p className="mt-4 text-base font-semibold text-neutral-900">
        {t("emptyTitle")}
      </p>
      <p className="mt-1 text-sm text-neutral-500">
        {t("emptyBody")}
      </p>
      <Link
        href="/dashboard/farmer/parcels/new"
        className="vc-btn-primary mt-5"
      >
        <PlusIcon size={14} /> {t("createParcel")}
      </Link>
    </div>
  );
}

async function ParcelListItem({ parcel }: { parcel: Parcel }) {
  const t = await getTranslations("farmer.parcels.list");
  const intlLocale = toIntlLocale(await getLocale());
  return (
    <CardLink
      href={`/dashboard/farmer/parcels/${parcel.id}`}
      ariaLabel={t("openAriaLabel", { name: parcel.name })}
      className="group relative block h-full overflow-hidden rounded-[1.25rem] border border-neutral-200/70 bg-white shadow-card focus:outline-none"
    >
      {/* ── Hero header ── */}
      <div className="relative flex items-end justify-between overflow-hidden bg-gradient-to-br from-katara-blue-600 via-leaf-600 to-leaf-500 p-5 pb-4">
        <LeafIcon
          size={96}
          className="pointer-events-none absolute -end-4 -top-4 opacity-10 text-white"
          strokeWidth={1}
        />
        <div className="relative min-w-0">
          <span className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white">
            <SproutIcon size={11} />
            {t("activeBadge")}
          </span>
          <h3 className="truncate text-xl font-bold leading-tight text-white drop-shadow-sm">
            {parcel.name}
          </h3>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/70">
            <SproutIcon size={11} />
            {parcel.crop_type} · {Number(parcel.surface_area_ha).toFixed(2)} ha
          </p>
        </div>
        <span className="relative ms-3 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/20 text-white backdrop-blur transition-all duration-300 group-hover:bg-white/35">
          <ArrowUpRightIcon
            size={15}
            className="rtl:-scale-x-100 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
          />
        </span>
      </div>

      {/* ── Body ── */}
      <div className="p-5">
        <p className="flex items-center gap-1.5 text-xs text-neutral-400">
          <CalendarIcon size={12} />
          {t("createdOn", { date: new Date(parcel.created_at).toLocaleDateString(intlLocale) })}
        </p>
        <p className="mt-3 text-xs text-neutral-500">
          {t("clickToView")}
        </p>
      </div>
    </CardLink>
  );
}
