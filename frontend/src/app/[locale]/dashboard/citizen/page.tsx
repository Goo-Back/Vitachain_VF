import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

import { getServerProfile } from "@/lib/auth/session";
import { fetchCatalog } from "@/app/[locale]/dashboard/restaurant/marketplace/actions";
import {
  ArrowRightIcon,
  MapPinIcon,
  PackageIcon,
  SparkleIcon,
  StoreIcon,
} from "@/app/[locale]/dashboard/farmer/_ui/Icon";
import { SecondServeLink } from "@/components/SecondServeLink";

import { AdCard } from "./marketplace/AdCard";

export const dynamic = "force-dynamic";

export default async function CitizenHomePage() {
  const t = await getTranslations("citizen.home");
  const profile = await getServerProfile();
  const firstName = profile?.full_name?.split(/\s+/)[0] ?? "";
  const hour = new Date().getHours();
  const greeting =
    hour < 12
      ? t("greeting.morning")
      : hour < 18
        ? t("greeting.afternoon")
        : t("greeting.evening");

  const catalog = await fetchCatalog({ page: 1 });
  const featured = [...catalog.items]
    .sort((a, b) => Number(b.is_featured) - Number(a.is_featured))
    .slice(0, 4);
  const regionCount = new Set(catalog.items.map((a) => a.region)).size;

  return (
    <div className="vc-fade-in space-y-8">
      <section className="relative overflow-hidden rounded-2xl">
        <Image
          src="/hero.jpg"
          alt=""
          fill
          priority
          className="object-cover"
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-neutral-900/85 via-neutral-900/40 to-neutral-900/10" />
        <div className="relative flex min-h-[220px] flex-col justify-end gap-4 p-6 sm:p-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-white/70">
              {greeting}
              {firstName ? `, ${firstName}` : ""}
            </p>
            <h1 className="mt-1 text-2xl font-bold text-white sm:text-3xl">
              {t("heroTitle")}
            </h1>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/dashboard/citizen/marketplace"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-neutral-900 shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lifted"
            >
              <StoreIcon size={16} /> {t("viewFarmarketAds")}
            </Link>
            <SecondServeLink
              path="/meals"
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:bg-amber-600 hover:shadow-lifted"
            >
              <SparkleIcon size={16} /> {t("surplusMeals")}
            </SecondServeLink>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile
          icon={<PackageIcon size={18} />}
          tint="info"
          label={t("tiles.availableAds")}
          value={catalog.total}
        />
        <Tile
          icon={<SparkleIcon size={18} />}
          tint="sun"
          label={t("tiles.featured")}
          value={catalog.items.filter((a) => a.is_featured).length}
        />
        <Tile
          icon={<MapPinIcon size={18} />}
          tint="leaf"
          label={t("tiles.regions")}
          value={regionCount}
        />
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-neutral-900">
              {t("featuredSection.title")}
            </h2>
            <p className="mt-0.5 text-sm text-neutral-500">
              {t("featuredSection.subtitle")}
            </p>
          </div>
          <Link
            href="/dashboard/citizen/marketplace"
            className="inline-flex items-center gap-1 text-sm font-medium text-market-blue-700 hover:underline"
          >
            {t("featuredSection.viewAll")}{" "}
            <ArrowRightIcon size={12} className="rtl:-scale-x-100" />
          </Link>
        </div>

        {featured.length === 0 ? (
          <div className="vc-card p-10 text-center">
            <p className="text-sm text-neutral-500">
              {t("featuredSection.empty")}
            </p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((ad) => (
              <AdCard key={ad.id} ad={ad} />
            ))}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-amber-50 to-white ring-1 ring-amber-100">
        <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:p-8">
          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-amber-100 sm:h-24 sm:w-24">
            <Image
              src="/secondserve.png"
              alt="SecondServe"
              fill
              className="object-contain p-3"
            />
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
              {t("secondServePromo.tag")}
            </p>
            <h2 className="mt-1 text-lg font-bold text-neutral-900">
              {t("secondServePromo.title")}
            </h2>
            <p className="mt-1 text-sm text-neutral-600">
              {t("secondServePromo.description")}
            </p>
          </div>
          <SecondServeLink
            path="/meals"
            className="inline-flex shrink-0 items-center gap-2 self-start rounded-xl bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-amber-700 hover:shadow-md sm:self-center"
          >
            {t("secondServePromo.cta")}{" "}
            <ArrowRightIcon size={14} className="rtl:-scale-x-100" />
          </SecondServeLink>
        </div>
      </section>
    </div>
  );
}

function Tile({
  icon,
  tint,
  label,
  value,
}: {
  icon: React.ReactNode;
  tint: "leaf" | "info" | "sun";
  label: string;
  value: number;
}) {
  const tintMap = {
    leaf: { bg: "bg-leaf-50", fg: "text-leaf-700" },
    info: { bg: "bg-sky-tint-50", fg: "text-sky-tint-700" },
    sun: { bg: "bg-sun-50", fg: "text-sun-700" },
  }[tint];

  return (
    <div className="vc-card p-4">
      <span
        className={`grid h-9 w-9 place-items-center rounded-xl ${tintMap.bg} ${tintMap.fg} ring-1 ring-inset ring-black/[0.03]`}
      >
        {icon}
      </span>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className="mt-0.5 text-3xl font-semibold tabular tracking-tight text-neutral-900">
        {value}
      </p>
    </div>
  );
}
