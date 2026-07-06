"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import { AlertIcon } from "./_ui/Icon";

/**
 * Route-level error boundary for /dashboard/farmer/*.
 *
 * Without this file, an uncaught error inside a streamed <Suspense> child
 * (e.g. SatelliteCard, ParcelGridWithVigors awaiting the NDVI fetch) has no
 * boundary to catch it — in dev this surfaces as a blank page stuck on
 * "Missing required error components, refreshing…" instead of a recoverable
 * in-page message.
 */
export default function FarmerDashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("farmer.overview.error");

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("Farmer dashboard error boundary:", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 py-20 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-red-50 text-red-700">
        <AlertIcon size={24} />
      </span>
      <div>
        <h2 className="text-lg font-bold text-neutral-900">
          {t("title")}
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          {t("body")}
        </p>
      </div>
      <button type="button" onClick={() => reset()} className="vc-btn-primary">
        {t("retry")}
      </button>
    </div>
  );
}
