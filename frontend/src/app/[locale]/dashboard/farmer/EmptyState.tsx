import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

import {
  AlertIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  DropletIcon,
  MapPinIcon,
  SatelliteIcon,
  SparkleIcon,
  SproutIcon,
  ThermometerIcon,
} from "./_ui/Icon";
import { FadeIn, Stagger, StaggerItem } from "./_ui/motion";

/**
 * KAT-14 — empty-state for a freshly-onboarded FARMER (zero parcels).
 *
 * Visual upgrade: welcome card with the value prop + CTA, a "what you'll
 * be able to do" feature strip, and a locked bento preview of the
 * dashboard the farmer unlocks after their first parcel — so the empty
 * state sells the next action instead of just describing it. Only
 * previews features Katara actually ships (parcel map, soil/crop KPIs);
 * no placeholder for unbuilt functionality (tasks, etc.).
 */

export async function EmptyState() {
  const t = await getTranslations("farmer.overview.empty");
  return (
    <FadeIn className="mx-auto max-w-5xl py-8">
      <div className="vc-card relative overflow-hidden p-8 sm:p-12">
        <div className="absolute -end-20 -top-20 h-72 w-72 rounded-full bg-sky-tint-50 blur-3xl" />
        <div className="absolute -bottom-24 -start-24 h-64 w-64 rounded-full bg-leaf-100/60 blur-3xl" />

        <div className="relative">
          <span className="inline-flex items-center gap-2 rounded-full bg-leaf-50 px-3 py-1 text-xs font-medium text-leaf-700">
            <SproutIcon size={12} /> {t("firstStep")}
          </span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            {t.rich("welcomeTitle", {
              katara: (chunks) => <span className="katara-text">{chunks}</span>,
            })}
          </h1>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-neutral-600">
            {t("welcomeBody")}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/dashboard/farmer/parcels/new"
              className="vc-btn-primary"
            >
              {t("ctaCreateFirst")}
              <ArrowRightIcon size={14} className="rtl:-scale-x-100" />
            </Link>
          </div>
        </div>

        <Stagger as="ul" className="relative mt-10 grid gap-4 sm:grid-cols-3">
          <Feature
            icon={<MapPinIcon size={18} className="text-sky-tint-700" />}
            tint="bg-sky-tint-50"
            title={t("featureParcelTitle")}
            desc={t("featureParcelDesc")}
          />
          <Feature
            icon={<DropletIcon size={18} className="text-sky-tint-700" />}
            tint="bg-sky-tint-50"
            title={t("featureSensorTitle")}
            desc={t("featureSensorDesc")}
          />
          <Feature
            icon={<SparkleIcon size={18} className="text-leaf-700" />}
            tint="bg-leaf-50"
            title={t("featureAdviceTitle")}
            desc={t("featureAdviceDesc")}
          />
        </Stagger>

        <div className="relative mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-neutral-100 pt-6 text-xs text-neutral-500">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircleIcon size={14} className="text-leaf-600" /> {t("freeTrial")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CheckCircleIcon size={14} className="text-leaf-600" /> {t("noCommitment")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <AlertIcon size={14} className="text-warn-600" />
            {t("verificationRequired")}
          </span>
        </div>
      </div>

      <DashboardPreview />
    </FadeIn>
  );
}

/**
 * Locked bento preview — same map + KPI-sidebar grammar as the dashboard
 * the farmer will see post-onboarding, dimmed and badged "à venir" so it
 * reads as a preview, not a broken/empty real view.
 */
async function DashboardPreview() {
  const t = await getTranslations("farmer.overview.empty");
  return (
    <div className="relative mt-6 grid grid-cols-1 gap-4 lg:grid-cols-12">
      <div className="pointer-events-none absolute inset-0 -top-2 z-10 flex items-start justify-center">
        <span className="mt-10 inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white/95 px-4 py-1.5 text-xs font-medium text-neutral-600 shadow-soft">
          <SproutIcon size={13} className="text-leaf-600" />
          {t("previewBadge")}
        </span>
      </div>

      <div className="vc-card relative col-span-1 min-h-[260px] overflow-hidden opacity-50 grayscale lg:col-span-8">
        <div
          className="h-full w-full bg-leaf-50"
          style={{
            backgroundImage:
              "radial-gradient(120% 90% at 20% 10%, var(--color-leaf-200), transparent 60%), radial-gradient(100% 80% at 80% 90%, var(--color-sky-tint-50), transparent 60%)",
          }}
        />
        <div className="absolute start-4 top-4 rounded-lg border border-neutral-200 bg-white/90 px-4 py-3">
          <p className="vc-eyebrow">{t("previewLiveMonitoring")}</p>
          <p className="text-lg font-semibold text-neutral-800">{t("previewYourParcels")}</p>
        </div>
      </div>

      <div className="col-span-1 flex flex-col gap-4 opacity-50 grayscale lg:col-span-4">
        <PreviewKpi
          icon={<DropletIcon size={22} className="text-sky-tint-700" />}
          label={t("previewSoilMoisture")}
          value="—"
          unit="%"
        />
        <PreviewKpi
          icon={<ThermometerIcon size={22} className="text-leaf-700" />}
          label={t("previewCropHealth")}
          value="—"
          unit="NDVI"
        />
        <PreviewKpi
          icon={<SatelliteIcon size={22} className="text-soil-700" />}
          label={t("previewSatelliteImagery")}
          value="—"
          unit=""
        />
      </div>
    </div>
  );
}

function PreviewKpi({
  icon,
  label,
  value,
  unit,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="vc-card flex-1 p-5">
      <div className="flex items-start justify-between">
        {icon}
      </div>
      <p className="mt-3 text-xs font-medium uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-neutral-700">
        {value} <span className="text-sm font-medium opacity-60">{unit}</span>
      </p>
    </div>
  );
}

function Feature({
  icon,
  tint,
  title,
  desc,
}: {
  icon: React.ReactNode;
  tint: string;
  title: string;
  desc: string;
}) {
  return (
    <StaggerItem as="li" className="rounded-xl border border-neutral-100 bg-white/70 p-4">
      <span className={`grid h-9 w-9 place-items-center rounded-xl ${tint}`}>
        {icon}
      </span>
      <p className="mt-3 text-sm font-medium text-neutral-900">{title}</p>
      <p className="mt-0.5 text-xs text-neutral-500">{desc}</p>
    </StaggerItem>
  );
}
