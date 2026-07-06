import { cache, Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

import { toIntlLocale } from "@/lib/intlLocale";
import { PageHeader } from "@/app/[locale]/dashboard/farmer/_ui/PageHeader";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  ClockIcon,
  InfoIcon,
  PackageIcon,
  ShoppingBagIcon,
  SparkleIcon,
  StoreIcon,
} from "@/app/[locale]/dashboard/farmer/_ui/Icon";

import { fetchCatalog } from "./marketplace/actions";
import { fetchMyOrders, type Order } from "./orders/actions";
import { AdCatalogCard } from "./marketplace/AdCatalogCard";
import { OrderStatusBadge } from "./orders/OrderStatusBadge";

export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = new Set([
  "PENDING",
  "PARTIALLY_ACCEPTED",
  "ACCEPTED",
  "IN_PROGRESS",
]);

// cache()-memoised so the KPI strip and the recent-orders list (two separate
// Suspense boundaries) share a single fetch of the order history per request.
const getOrders = cache(async () => fetchMyOrders());

export default async function RestaurantOverviewPage() {
  const t = await getTranslations("restaurant.overview");
  // The header and the static "how it works" aside render immediately; every
  // data-backed section streams in below via <Suspense>, so the page is never
  // blank-blocked on the orders / catalog round-trips.
  return (
    <div className="vc-fade-in">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Link
            href="/dashboard/restaurant/marketplace"
            className="vc-btn-primary"
          >
            <StoreIcon size={16} /> {t("browseCatalog")}
          </Link>
        }
      />

      <Suspense fallback={<KpiStripSkeleton />}>
        <HomeKpis />
      </Suspense>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <Suspense fallback={<RecentOrdersSkeleton />}>
          <HomeRecentOrders />
        </Suspense>

        {/* Process / how it works — fully static, paints with the header. */}
        <aside className="vc-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-leaf-50">
              <InfoIcon size={16} className="text-leaf-700" />
            </span>
            <h2 className="text-base font-semibold text-neutral-900">
              {t("howItWorksTitle")}
            </h2>
          </div>
          <ol className="space-y-3 text-sm text-neutral-700">
            <Step n={1} title={t("step1Title")} body={t("step1Body")} />
            <Step n={2} title={t("step2Title")} body={t("step2Body")} />
            <Step n={3} title={t("step3Title")} body={t("step3Body")} />
            <Step n={4} title={t("step4Title")} body={t("step4Body")} />
          </ol>
          <Link
            href="/dashboard/restaurant/help"
            className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-leaf-700 hover:underline"
          >
            {t("learnMore")} <ArrowRightIcon size={12} className="rtl:-scale-x-100" />
          </Link>
        </aside>
      </div>

      <Suspense fallback={null}>
        <HomeFeatured />
      </Suspense>
    </div>
  );
}

async function HomeKpis() {
  const t = await getTranslations("restaurant.overview");
  const kpis = computeKpis(await getOrders());

  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        icon={<ClockIcon size={18} className="text-blue-600" />}
        label={t("kpiActiveLabel")}
        value={String(kpis.active)}
        hint={kpis.active === 0 ? t("kpiActiveHintZero") : t("kpiActiveHint")}
        tone="blue"
      />
      <KpiCard
        icon={<CheckCircleIcon size={18} className="text-emerald-600" />}
        label={t("kpiDeliveredLabel")}
        value={String(kpis.delivered)}
        hint={t("kpiDeliveredHint")}
        tone="emerald"
      />
      <KpiCard
        icon={<ShoppingBagIcon size={18} className="text-leaf-700" />}
        label={t("kpiSpentLabel")}
        value={`${kpis.spentThisMonth.toFixed(0)} MAD`}
        hint={t("kpiSpentHint", { count: kpis.ordersThisMonth })}
        tone="leaf"
      />
      <KpiCard
        icon={<PackageIcon size={18} className="text-amber-600" />}
        label={t("kpiAvgBasketLabel")}
        value={`${kpis.avgBasket.toFixed(0)} MAD`}
        hint={t("kpiAvgBasketHint")}
        tone="amber"
      />
    </section>
  );
}

async function HomeRecentOrders() {
  const t = await getTranslations("restaurant.overview");
  const intlLocale = toIntlLocale(await getLocale());
  const orders = await getOrders();
  const recent = orders.slice(0, 5);

  return (
    <section className="vc-card lg:col-span-2 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-neutral-900">
            {t("recentOrdersTitle")}
          </h2>
          <p className="text-xs text-neutral-500">
            {t("recentOrdersSubtitle")}
          </p>
        </div>
        <Link
          href="/dashboard/restaurant/orders"
          className="text-xs text-leaf-700 hover:underline"
        >
          {t("seeAll")} →
        </Link>
      </div>

      {recent.length === 0 ? (
        <EmptyOrders />
      ) : (
        <ul className="divide-y divide-neutral-100">
          {recent.map((o) => (
            <li key={o.id}>
              <Link
                href={`/dashboard/restaurant/orders/${o.id}`}
                className="flex items-center gap-4 py-3 transition hover:bg-neutral-50"
              >
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-leaf-50">
                  <PackageIcon size={16} className="text-leaf-700" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs text-neutral-700">
                    VITA-{o.id.replace(/-/g, "").slice(0, 8).toUpperCase()}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {t("itemsCount", { count: o.items.length })}{" "}
                    · {o.delivery_region} ·{" "}
                    {new Date(o.created_at).toLocaleDateString(intlLocale)}
                  </p>
                </div>
                <p className="hidden text-sm font-medium text-neutral-900 sm:block">
                  {Number(o.total_mad).toFixed(0)} MAD
                </p>
                <OrderStatusBadge status={o.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function HomeFeatured() {
  const t = await getTranslations("restaurant.overview");
  const featured = await fetchCatalog({ page: 1 });
  const topFeatured = featured.items.filter((a) => a.is_featured).slice(0, 3);

  if (topFeatured.length === 0) return null;

  return (
    <section className="mt-8">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SparkleIcon size={16} className="text-amber-500" />
          <h2 className="text-base font-semibold text-neutral-900">
            {t("featuredTitle")}
          </h2>
        </div>
        <Link
          href="/dashboard/restaurant/marketplace"
          className="text-xs text-leaf-700 hover:underline"
        >
          {t("seeAllShort")} →
        </Link>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {topFeatured.map((ad) => (
          <AdCatalogCard key={ad.id} ad={ad} />
        ))}
      </ul>
    </section>
  );
}

function KpiStripSkeleton() {
  return (
    <section
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      aria-busy="true"
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="vc-card p-4">
          <div className="vc-skeleton h-9 w-9 rounded-lg" />
          <div className="vc-skeleton mt-3 h-3 w-20" />
          <div className="vc-skeleton mt-2 h-6 w-16" />
        </div>
      ))}
    </section>
  );
}

function RecentOrdersSkeleton() {
  return (
    <section className="vc-card lg:col-span-2 p-5" aria-busy="true">
      <div className="vc-skeleton h-5 w-40" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="vc-skeleton h-12 w-full" />
        ))}
      </div>
    </section>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone: "leaf" | "blue" | "emerald" | "amber";
}) {
  const ring =
    tone === "leaf"
      ? "ring-leaf-100 bg-leaf-50"
      : tone === "blue"
        ? "ring-blue-100 bg-blue-50"
        : tone === "emerald"
          ? "ring-emerald-100 bg-emerald-50"
          : "ring-amber-100 bg-amber-50";
  return (
    <div className="vc-card p-4">
      <div className="flex items-start gap-3">
        <span className={`grid h-9 w-9 place-items-center rounded-lg ring-1 ${ring}`}>
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            {label}
          </p>
          <p className="mt-1 text-xl font-bold text-neutral-900">{value}</p>
          {hint && <p className="text-xs text-neutral-500">{hint}</p>}
        </div>
      </div>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-leaf-600 text-[11px] font-semibold text-white">
        {n}
      </span>
      <div>
        <p className="text-sm font-medium text-neutral-900">{title}</p>
        <p className="text-xs text-neutral-500">{body}</p>
      </div>
    </li>
  );
}

async function EmptyOrders() {
  const t = await getTranslations("restaurant");
  return (
    <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/50 p-6 text-center">
      <p className="text-sm font-medium text-neutral-900">
        {t("overview.emptyOrdersTitle")}
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        {t("overview.emptyOrdersBody")}
      </p>
      <Link
        href="/dashboard/restaurant/marketplace"
        className="vc-btn-primary mt-4"
      >
        <StoreIcon size={14} /> {t("common.goToCatalog")}
      </Link>
    </div>
  );
}

function computeKpis(orders: Order[]) {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${now.getMonth()}`;

  let active = 0;
  let delivered = 0;
  let spentThisMonth = 0;
  let ordersThisMonth = 0;
  let totalSpent = 0;
  let nonCancelledCount = 0;

  for (const o of orders) {
    if (o.status === "DELIVERED") delivered++;
    if (ACTIVE_STATUSES.has(o.status)) active++;

    if (o.status !== "CANCELLED" && o.status !== "REJECTED") {
      totalSpent += Number(o.total_mad);
      nonCancelledCount++;
      const d = new Date(o.created_at);
      const k = `${d.getFullYear()}-${d.getMonth()}`;
      if (k === monthKey) {
        spentThisMonth += Number(o.total_mad);
        ordersThisMonth++;
      }
    }
  }

  return {
    active,
    delivered,
    spentThisMonth,
    ordersThisMonth,
    avgBasket: nonCancelledCount > 0 ? totalSpent / nonCancelledCount : 0,
  };
}
