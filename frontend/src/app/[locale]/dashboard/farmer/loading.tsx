import { getTranslations } from "next-intl/server";

/**
 * Streaming fallback for every /dashboard/farmer/* route.
 *
 * Shown the instant a navigation starts, while the server component awaits its
 * data (parcels / weather / diagnostics over the frontend→FastAPI→Supabase
 * hop). The layout shell (sidebar + topbar) is already painted and persists
 * across sub-route navigation, so only this content column streams — the page
 * *feels* immediate even though the data round-trip is unchanged.
 */
export default async function FarmerDashboardLoading() {
  const t = await getTranslations("farmer.overview.loading");
  return (
    <div className="mx-auto max-w-7xl" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("srLoading")}</span>

      {/* Header: eyebrow + title + subtitle */}
      <div className="mb-6 space-y-2.5">
        <div className="vc-skeleton h-3 w-24" />
        <div className="vc-skeleton h-8 w-72 max-w-full" />
        <div className="vc-skeleton h-4 w-96 max-w-full" />
      </div>

      {/* KPI strip */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="vc-card p-4">
            <div className="vc-skeleton h-3 w-16" />
            <div className="vc-skeleton mt-3 h-7 w-20" />
          </div>
        ))}
      </div>

      {/* Content card grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="vc-card p-5">
            <div className="vc-skeleton h-4 w-1/2" />
            <div className="vc-skeleton mt-3 h-3 w-3/4" />
            <div className="vc-skeleton mt-2 h-3 w-2/3" />
            <div className="vc-skeleton mt-5 h-24 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
