"use client";

import Link from "next/link";

import { SparkleIcon, StoreIcon, TrashIcon } from "@/app/dashboard/farmer/_ui/Icon";
import { useCart } from "@/lib/cart";
import { useFavorites } from "@/lib/favorites";

export function FavoritesList() {
  const { favorites, removeFavorite, clearFavorites } = useFavorites();
  const { addToCart } = useCart();

  if (favorites.length === 0) {
    return (
      <div className="vc-card p-10 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-leaf-50">
          <SparkleIcon size={20} className="text-leaf-700" />
        </div>
        <p className="mt-3 text-sm font-semibold text-neutral-900">
          Aucune annonce sauvegardée.
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          Ajoutez le cœur sur une annonce du catalogue pour la retrouver ici.
        </p>
        <Link
          href="/dashboard/restaurant/marketplace"
          className="vc-btn-primary mt-4"
        >
          <StoreIcon size={14} /> Aller au catalogue
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-neutral-500">
          {favorites.length} annonce{favorites.length > 1 ? "s" : ""} sauvegardée
          {favorites.length > 1 ? "s" : ""}
        </p>
        <button
          type="button"
          onClick={clearFavorites}
          className="text-xs text-red-600 hover:underline"
        >
          Tout retirer
        </button>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {favorites.map((f) => {
          const price = Number(f.ad.price_mad).toFixed(2);
          const qty = Number(f.ad.quantity_kg).toFixed(0);
          return (
            <li key={f.ad.id}>
              <div className="vc-card overflow-hidden p-0">
                <Link href={`/dashboard/restaurant/marketplace/${f.ad.id}`}>
                  {f.ad.photo_urls[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={f.ad.photo_urls[0]}
                      alt={f.ad.title}
                      className="h-36 w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-36 w-full items-center justify-center bg-leaf-50">
                      <span className="text-4xl">🌿</span>
                    </div>
                  )}
                </Link>
                <div className="p-4">
                  <Link
                    href={`/dashboard/restaurant/marketplace/${f.ad.id}`}
                    className="block"
                  >
                    <p className="truncate text-sm font-semibold text-neutral-900 hover:text-leaf-700">
                      {f.ad.title}
                    </p>
                  </Link>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {f.ad.product_type} · {f.ad.region}
                  </p>
                  <p className="mt-2 text-base font-bold text-leaf-700">
                    {price}{" "}
                    <span className="text-xs font-normal text-neutral-400">
                      MAD/kg
                    </span>
                  </p>
                  <p className="text-xs text-neutral-500">{qty} kg disponibles</p>

                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => addToCart(f.ad, 1)}
                      className="flex-1 rounded bg-leaf-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-leaf-700"
                    >
                      Ajouter au panier
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFavorite(f.ad.id)}
                      aria-label="Retirer des favoris"
                      className="grid h-8 w-8 place-items-center rounded border border-neutral-200 text-neutral-500 hover:border-red-200 hover:text-red-600"
                    >
                      <TrashIcon size={14} />
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
