import type { Ad } from "@/app/dashboard/farmer/ads/actions";
import { AddToCartButton } from "./AddToCartButton";

export function AdCatalogCard({ ad }: { ad: Ad }) {
  const price = Number(ad.price_mad).toFixed(2);
  const qty = Number(ad.quantity_kg).toFixed(0);

  return (
    <li>
      <div className="vc-card overflow-hidden p-0">
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

        <div className="p-4">
          {ad.is_featured && (
            <span className="mb-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
              ★ En vedette
            </span>
          )}

          <p className="truncate text-sm font-semibold text-neutral-900">
            {ad.title}
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">{ad.product_type}</p>

          <p className="mt-2 text-base font-bold text-leaf-700">
            {price}{" "}
            <span className="text-xs font-normal text-neutral-400">MAD/kg</span>
          </p>
          <p className="text-xs text-neutral-500">{qty} kg disponibles</p>
          <p className="mt-1 text-xs text-neutral-400">{ad.region}</p>

          {/* FAR-03 (rewritten) — cart-based ordering. VitaChain acts as the
              logistics intermediary; no contact info is ever exchanged
              between resto and producer. */}
          <AddToCartButton ad={ad} />
        </div>
      </div>
    </li>
  );
}
