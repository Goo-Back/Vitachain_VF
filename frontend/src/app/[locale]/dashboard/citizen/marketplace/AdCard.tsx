import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import type { Ad } from "@/app/[locale]/dashboard/farmer/ads/actions";

/** Read-only catalog card for citizens — browsing only, no cart/favorites. */
export async function AdCard({ ad }: { ad: Ad }) {
  const t = await getTranslations("citizen.adCard");
  const price = Number(ad.price_mad).toFixed(2);
  const stock = Number(ad.quantity_kg);
  const qty = stock.toFixed(0);
  const soldOut = stock <= 0;

  return (
    <li className="group">
      <Link
        href={`/dashboard/citizen/marketplace/${ad.id}`}
        className="vc-card vc-card-interactive flex h-full flex-col overflow-hidden p-0"
      >
        <div className="relative overflow-hidden">
          {ad.photo_urls[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={ad.photo_urls[0]}
              alt={ad.title}
              className="h-40 w-full scale-100 object-cover transition-transform duration-700 ease-out group-hover:scale-110"
            />
          ) : (
            <div className="flex h-40 w-full items-center justify-center bg-gradient-to-br from-leaf-50 to-leaf-100">
              <span className="text-4xl">🌿</span>
            </div>
          )}

          <div className="absolute start-2 top-2">
            {soldOut ? (
              <span className="vc-pill-danger vc-pill">{t("soldOut")}</span>
            ) : ad.is_featured ? (
              <span className="vc-pill-leaf vc-pill shadow-sm">
                ★ {t("featured")}
              </span>
            ) : null}
          </div>
          {soldOut && (
            <div className="absolute inset-0 bg-white/50" aria-hidden="true" />
          )}
        </div>

        <div className="flex flex-1 flex-col p-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-semibold text-neutral-900 transition-colors duration-300 group-hover:text-leaf-700">
              {ad.title}
            </span>
            <span className="shrink-0 text-sm font-bold text-leaf-700">
              {price}
              <span className="ms-0.5 text-xs font-normal text-neutral-400">
                MAD/kg
              </span>
            </span>
          </div>
          <p className="mt-0.5 truncate text-[0.7rem] font-medium uppercase tracking-wide text-neutral-400">
            {ad.product_type} ·{" "}
            {soldOut ? t("outOfStock") : t("kgAvailable", { qty })}
          </p>
        </div>
      </Link>
    </li>
  );
}
