import { getTranslations } from "next-intl/server";

/**
 * Streaming fallback for every /dashboard/restaurant/* route. See the farmer
 * counterpart for the rationale — the cart/topbar shell stays painted while
 * the content column (marketplace, orders, cart) streams in.
 */
export default async function RestaurantDashboardLoading() {
  const t = await getTranslations("restaurant.common");
  return (
    <div className="mx-auto max-w-7xl" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("loading")}</span>

      {/* Header */}
      <div className="mb-6 space-y-2.5">
        <div className="vc-skeleton h-3 w-24" />
        <div className="vc-skeleton h-8 w-72 max-w-full" />
        <div className="vc-skeleton h-4 w-96 max-w-full" />
      </div>

      {/* Card grid (catalogue / orders) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="vc-card p-5">
            <div className="vc-skeleton h-36 w-full" />
            <div className="vc-skeleton mt-4 h-4 w-2/3" />
            <div className="vc-skeleton mt-2 h-3 w-1/2" />
            <div className="vc-skeleton mt-4 h-9 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
