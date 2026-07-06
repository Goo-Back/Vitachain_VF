"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useState, useTransition } from "react";

import { fetchAdById } from "@/app/[locale]/dashboard/restaurant/marketplace/actions";
import { useCart } from "@/lib/cart";

type Item = {
  ad_id: string;
  quantity_kg: string;
};

type Props = {
  items: Item[];
  variant?: "primary" | "ghost";
};

/**
 * Re-add the items of a past order to the cart. Each item is re-fetched
 * from the catalog so the snapshot (price, stock, region) is fresh — an
 * unavailable item is skipped and reported back to the user.
 */
export function ReorderButton({ items, variant = "ghost" }: Props) {
  const t = useTranslations("restaurant.orders.reorderButton");
  const router = useRouter();
  const { addToCart } = useCart();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const cls =
    variant === "primary" ? "vc-btn-primary" : "vc-btn-secondary";

  function handleClick() {
    setMessage(null);
    startTransition(async () => {
      let added = 0;
      let skipped = 0;
      for (const it of items) {
        const ad = await fetchAdById(it.ad_id);
        if (!ad) {
          skipped++;
          continue;
        }
        const stock = Number(ad.quantity_kg);
        const requested = Math.max(1, Math.floor(Number(it.quantity_kg)));
        const qty = Math.min(stock, requested);
        if (qty <= 0) {
          skipped++;
          continue;
        }
        addToCart(
          {
            id: ad.id,
            title: ad.title,
            product_type: ad.product_type,
            price_mad: ad.price_mad,
            quantity_kg: ad.quantity_kg,
            region: ad.region,
            photo_urls: ad.photo_urls,
            farmer_id: ad.farmer_id,
          },
          qty,
        );
        added++;
      }

      if (added === 0) {
        setMessage(t("noneAvailable"));
        return;
      }
      if (skipped > 0) {
        setMessage(t("addedSkipped", { added, skipped }));
      }
      router.push("/dashboard/restaurant/cart");
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className={`${cls} disabled:opacity-60`}
      >
        {isPending ? t("preparing") : t("reorder")}
      </button>
      {message && (
        <p className="mt-2 text-xs text-amber-700">{message}</p>
      )}
    </div>
  );
}
