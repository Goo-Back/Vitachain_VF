import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

import type { Ad } from "@/app/[locale]/dashboard/farmer/ads/actions";
import { FavoriteButton } from "../favorites/FavoriteButton";
import { AddToCartButton } from "./AddToCartButton";

export async function AdCatalogCard({ ad }: { ad: Ad }) {
  const t = await getTranslations("restaurant");
  const price = Number(ad.price_mad).toFixed(2);
  const stock = Number(ad.quantity_kg);
  const qty = stock.toFixed(0);
  const soldOut = stock <= 0;

  const favSnapshot = {
    id: ad.id,
    title: ad.title,
    product_type: ad.product_type,
    price_mad: ad.price_mad,
    quantity_kg: ad.quantity_kg,
    region: ad.region,
    photo_urls: ad.photo_urls,
    farmer_id: ad.farmer_id,
  };

  return (
    <li className="group">
      <div className="vc-card vc-card-interactive flex h-full flex-col overflow-hidden p-0">
        <div className="relative overflow-hidden">
          <Link
            href={`/dashboard/restaurant/marketplace/${ad.id}`}
            className="block overflow-hidden"
          >
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
          </Link>

          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/25 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100"
            aria-hidden="true"
          />

          <div className="absolute start-2 top-2">
            {soldOut ? (
              <span className="vc-pill-danger vc-pill">{t("common.soldOut")}</span>
            ) : ad.is_featured ? (
              <span className="vc-pill-leaf vc-pill shadow-sm">{t("marketplace.card.featured")}</span>
            ) : null}
          </div>
          <div className="absolute end-2 top-2 transition-transform duration-300 ease-out group-hover:scale-105">
            <FavoriteButton ad={favSnapshot} />
          </div>
          {soldOut && (
            <div className="absolute inset-0 bg-white/50" aria-hidden="true" />
          )}
        </div>

        <div className="flex flex-1 flex-col p-4">
          <Link
            href={`/dashboard/restaurant/marketplace/${ad.id}`}
            className="flex items-baseline justify-between gap-2"
          >
            <span className="truncate text-sm font-semibold text-neutral-900 transition-colors duration-300 group-hover:text-leaf-700">
              {ad.title}
            </span>
            <span className="shrink-0 text-sm font-bold text-leaf-700">
              {price}
              <span className="ms-0.5 text-xs font-normal text-neutral-400">
                MAD/kg
              </span>
            </span>
          </Link>
          <p className="mt-0.5 truncate text-[0.7rem] font-medium uppercase tracking-wide text-neutral-400">
            {ad.product_type} · {soldOut ? t("common.outOfStock") : t("marketplace.card.stockAvailable", { qty })}
          </p>

          <div className="mt-auto pt-4">
            <AddToCartButton ad={ad} />
          </div>
        </div>
      </div>
    </li>
  );
}
