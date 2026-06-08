import Link from "next/link";

import type { Ad } from "@/app/dashboard/farmer/ads/actions";
import { ArrowRightIcon } from "@/app/dashboard/farmer/_ui/Icon";
import { FavoriteButton } from "../favorites/FavoriteButton";
import { AddToCartButton } from "./AddToCartButton";

export function AdCatalogCard({ ad }: { ad: Ad }) {
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
    <li>
      <div className="vc-card overflow-hidden p-0 transition hover:shadow-card-hover">
        <div className="relative">
          <Link
            href={`/dashboard/restaurant/marketplace/${ad.id}`}
            className="block"
          >
            {ad.photo_urls[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ad.photo_urls[0]}
                alt={ad.title}
                className="h-40 w-full object-cover"
              />
            ) : (
              <div className="flex h-40 w-full items-center justify-center bg-leaf-50">
                <span className="text-4xl">🌿</span>
              </div>
            )}
          </Link>
          <div className="absolute right-2 top-2">
            <FavoriteButton ad={favSnapshot} />
          </div>
          {soldOut && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/60">
              <span className="rounded-full bg-neutral-900/80 px-3 py-1 text-xs font-semibold text-white">
                Épuisé
              </span>
            </div>
          )}
        </div>

        <div className="p-4">
          {ad.is_featured && (
            <span className="mb-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
              ★ En vedette
            </span>
          )}

          <Link
            href={`/dashboard/restaurant/marketplace/${ad.id}`}
            className="group block"
          >
            <p className="truncate text-sm font-semibold text-neutral-900 group-hover:text-leaf-700">
              {ad.title}
            </p>
          </Link>
          <p className="mt-0.5 text-xs text-neutral-500">{ad.product_type}</p>

          <p className="mt-2 text-base font-bold text-leaf-700">
            {price}{" "}
            <span className="text-xs font-normal text-neutral-400">MAD/kg</span>
          </p>
          <p className="text-xs text-neutral-500">
            {soldOut ? "Rupture de stock" : `${qty} kg disponibles`}
          </p>
          <p className="mt-1 text-xs text-neutral-400">{ad.region}</p>

          <AddToCartButton ad={ad} />

          <Link
            href={`/dashboard/restaurant/marketplace/${ad.id}`}
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-leaf-700 hover:underline"
          >
            Voir le détail <ArrowRightIcon size={12} />
          </Link>
        </div>
      </div>
    </li>
  );
}
