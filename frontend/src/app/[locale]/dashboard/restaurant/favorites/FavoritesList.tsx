"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

import {
  ShoppingBagIcon,
  SparkleIcon,
  StoreIcon,
  TrashIcon,
} from "@/app/[locale]/dashboard/farmer/_ui/Icon";
import { useCart } from "@/lib/cart";
import { useFavorites } from "@/lib/favorites";

export function FavoritesList() {
  const t = useTranslations("restaurant");
  const { favorites, removeFavorite, clearFavorites } = useFavorites();
  const { addToCart } = useCart();

  if (favorites.length === 0) {
    return (
      <div className="vc-card p-10 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-leaf-50">
          <SparkleIcon size={20} className="text-leaf-700" />
        </div>
        <p className="mt-3 text-sm font-semibold text-neutral-900">
          {t("favorites.list.emptyTitle")}
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          {t("favorites.list.emptyBody")}
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-neutral-500">
          {t("favorites.list.savedCount", { count: favorites.length })}
        </p>
        <button
          type="button"
          onClick={clearFavorites}
          className="text-xs text-red-600 hover:underline"
        >
          {t("favorites.list.clearAll")}
        </button>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {favorites.map((f) => {
          const price = Number(f.ad.price_mad).toFixed(2);
          const stock = Number(f.ad.quantity_kg);
          const qty = stock.toFixed(0);
          const soldOut = stock <= 0;
          return (
            <li key={f.ad.id} className="group">
              <div className="vc-card vc-card-interactive flex h-full flex-col overflow-hidden p-0">
                <div className="relative overflow-hidden">
                  <Link
                    href={`/dashboard/restaurant/marketplace/${f.ad.id}`}
                    className="block overflow-hidden"
                  >
                    {f.ad.photo_urls[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={f.ad.photo_urls[0]}
                        alt={f.ad.title}
                        className="h-36 w-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
                      />
                    ) : (
                      <div className="flex h-36 w-full items-center justify-center bg-gradient-to-br from-leaf-50 to-leaf-100">
                        <span className="text-4xl">🌿</span>
                      </div>
                    )}
                  </Link>

                  <div
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/25 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                    aria-hidden="true"
                  />

                  {soldOut && (
                    <span className="absolute start-2 top-2 vc-pill-danger vc-pill">
                      {t("common.soldOut")}
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => removeFavorite(f.ad.id)}
                    aria-label={t("favorites.list.removeAria")}
                    className="absolute end-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/85 text-neutral-600 backdrop-blur transition-all duration-300 ease-out hover:scale-105 hover:bg-red-500 hover:text-white"
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>

                <div className="flex flex-1 flex-col p-4">
                  <Link
                    href={`/dashboard/restaurant/marketplace/${f.ad.id}`}
                    className="flex items-baseline justify-between gap-2"
                  >
                    <span className="truncate text-sm font-semibold text-neutral-900 transition-colors duration-300 group-hover:text-leaf-700">
                      {f.ad.title}
                    </span>
                    <span className="shrink-0 text-sm font-bold text-leaf-700">
                      {price}
                      <span className="ms-0.5 text-xs font-normal text-neutral-400">
                        MAD/kg
                      </span>
                    </span>
                  </Link>
                  <p className="mt-0.5 truncate text-[0.7rem] font-medium uppercase tracking-wide text-neutral-400">
                    {f.ad.product_type} · {soldOut ? t("common.outOfStock") : t("marketplace.card.stockAvailable", { qty })}
                  </p>

                  <div className="mt-auto pt-4">
                    <button
                      type="button"
                      disabled={soldOut}
                      onClick={() => addToCart(f.ad, 1)}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-700 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-market-blue-500 hover:bg-market-blue-600 hover:text-white hover:shadow-md hover:shadow-market-blue-600/20 active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
                    >
                      {soldOut ? (
                        t("common.soldOut")
                      ) : (
                        <>
                          <ShoppingBagIcon size={14} />
                          {t("common.addToCart")}
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
