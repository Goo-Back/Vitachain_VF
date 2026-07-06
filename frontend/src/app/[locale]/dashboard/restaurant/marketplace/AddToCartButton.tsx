"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { useCart } from "@/lib/cart";
import type { Ad } from "@/app/[locale]/dashboard/farmer/ads/actions";
import { ShoppingBagIcon } from "@/app/[locale]/dashboard/farmer/_ui/Icon";

type Props = {
  ad: Pick<
    Ad,
    | "id"
    | "title"
    | "product_type"
    | "price_mad"
    | "quantity_kg"
    | "region"
    | "photo_urls"
    | "farmer_id"
  >;
};

export function AddToCartButton({ ad }: Props) {
  const t = useTranslations("restaurant");
  const { addToCart } = useCart();
  const [qty, setQty] = useState<number>(1);
  const [feedback, setFeedback] = useState<string | null>(null);

  const stock = Number(ad.quantity_kg);
  const soldOut = stock <= 0;

  function handleAdd() {
    if (qty <= 0) return;
    if (qty > stock) {
      setFeedback(t("marketplace.addToCart.stockAvailable", { stock }));
      return;
    }
    addToCart(ad, qty);
    setFeedback(t("marketplace.addToCart.added", { qty }));
    window.setTimeout(() => setFeedback(null), 2500);
  }

  if (soldOut) {
    return (
      <span className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        {t("common.soldOut")}
      </span>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={stock}
          step={1}
          value={qty}
          onChange={(e) => setQty(Number(e.target.value))}
          className="w-12 rounded-lg border border-neutral-200 px-1.5 py-2 text-center text-xs transition-colors duration-200 focus:border-market-blue-400 focus:outline-none focus:ring-2 focus:ring-market-blue-100"
          aria-label={t("marketplace.addToCart.quantityAriaLabel")}
        />
        <button
          type="button"
          onClick={handleAdd}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-700 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-market-blue-500 hover:bg-market-blue-600 hover:text-white hover:shadow-md hover:shadow-market-blue-600/20 active:translate-y-0"
        >
          <ShoppingBagIcon size={14} />
          {t("marketplace.addToCart.addButton")}
        </button>
      </div>
      {feedback && (
        <p className="animate-[vc-fade-in_240ms_ease-out] text-[0.7rem] font-medium text-leaf-700">
          {feedback}
        </p>
      )}
    </div>
  );
}
