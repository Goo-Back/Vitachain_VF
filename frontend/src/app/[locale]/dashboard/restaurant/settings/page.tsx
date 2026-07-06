import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

import { getServerProfile } from "@/lib/auth/session";
import { MOROCCO_REGIONS } from "@/app/[locale]/dashboard/farmer/ads/new/regions";

import {
  ArrowRightIcon,
  CheckCircleIcon,
  InfoIcon,
  LogoutIcon,
  PackageIcon,
  SettingsIcon,
} from "@/app/[locale]/dashboard/farmer/_ui/Icon";
import { PageHeader } from "@/app/[locale]/dashboard/farmer/_ui/PageHeader";

import { DeliveryPreferencesForm } from "./DeliveryPreferencesForm";

export const dynamic = "force-dynamic";

export default async function RestaurantSettingsPage() {
  const t = await getTranslations("restaurant");
  const profile = await getServerProfile();

  const isVerified = profile?.verification_status === "VERIFIED";
  // Language names are shown as endonyms (each language's own name for
  // itself) — this is independent of the current UI locale, so it is not
  // routed through the translator.
  const localeLabel =
    profile?.locale === "ar"
      ? "العربية"
      : profile?.locale === "en"
        ? "English"
        : "Français";

  return (
    <div className="mx-auto max-w-3xl vc-fade-in">
      <PageHeader
        crumbs={[
          { label: t("common.crumbRestaurant"), href: "/dashboard/restaurant" },
          { label: t("settings.page.crumbSettings") },
        ]}
        eyebrow={t("settings.page.eyebrow")}
        title={t("settings.page.title")}
        subtitle={t("settings.page.subtitle")}
      />

      <div className="space-y-6">
        <SectionCard
          icon={<SettingsIcon size={18} className="text-leaf-700" />}
          title={t("settings.page.profileSectionTitle")}
        >
          <dl className="grid gap-4 sm:grid-cols-2">
            <Row label={t("settings.page.companyName")} value={profile?.full_name ?? "—"} />
            <Row label={t("settings.page.email")} value={profile?.email ?? "—"} />
            <Row label={t("settings.page.phone")} value={profile?.phone ?? "—"} />
            <Row label={t("settings.page.role")} value={t("settings.page.roleValue")} />
            <Row label={t("settings.page.language")} value={localeLabel} />
          </dl>
          <p className="mt-4 text-xs text-neutral-500">
            {t("settings.page.profileNote")}
          </p>
        </SectionCard>

        <SectionCard
          icon={<PackageIcon size={18} className="text-leaf-700" />}
          title={t("settings.page.deliveryPrefsTitle")}
        >
          <DeliveryPreferencesForm regions={MOROCCO_REGIONS} />
        </SectionCard>

        <SectionCard
          icon={<CheckCircleIcon size={18} className="text-leaf-700" />}
          title={t("settings.page.verificationTitle")}
        >
          <div
            className={`flex items-start gap-3 rounded-lg p-4 ${
              isVerified
                ? "bg-leaf-50 ring-1 ring-leaf-200"
                : "bg-warn-50 ring-1 ring-warn-500/30"
            }`}
          >
            {isVerified ? (
              <CheckCircleIcon size={20} className="mt-0.5 text-leaf-700" />
            ) : (
              <InfoIcon size={20} className="mt-0.5 text-warn-700" />
            )}
            <div className="flex-1">
              <p
                className={`text-sm font-semibold ${
                  isVerified ? "text-leaf-800" : "text-warn-700"
                }`}
              >
                {isVerified
                  ? t("settings.page.verifiedStatus")
                  : profile?.verification_status === "PENDING"
                    ? t("settings.page.pendingStatus")
                    : t("settings.page.requiredStatus")}
              </p>
              <p className="mt-1 text-sm text-neutral-700">
                {isVerified
                  ? t("settings.page.verifiedBody")
                  : t("settings.page.unverifiedBody")}
              </p>
              {!isVerified ? (
                <Link
                  href="/onboarding/verification"
                  className="vc-btn-primary mt-3"
                >
                  {t("settings.page.submitDocuments")} <ArrowRightIcon size={14} className="rtl:-scale-x-100" />
                </Link>
              ) : null}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          icon={<LogoutIcon size={18} className="text-neutral-500" />}
          title={t("settings.page.sessionTitle")}
        >
          <form action="/auth/signout" method="post">
            <button type="submit" className="vc-btn-ghost">
              <LogoutIcon size={14} /> {t("settings.page.signOut")}
            </button>
          </form>
        </SectionCard>
      </div>
    </div>
  );
}

function SectionCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="vc-card p-6">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-leaf-50">
          {icon}
        </span>
        <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-neutral-900">{value}</dd>
    </div>
  );
}
