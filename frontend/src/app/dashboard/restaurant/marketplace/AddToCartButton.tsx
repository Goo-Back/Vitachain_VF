"use client";

import { useState } from "react";

import { useCart } from "@/lib/cart";
import type { Ad } from "@/app/dashboard/farmer/ads/actions";

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
  const { addToCart } = useCart();
  const [qty, setQty] = useState<number>(1);
  const [feedback, setFeedback] = useState<string | null>(null);

  const stock = Number(ad.quantity_kg);
  const soldOut = stock <= 0;

  function handleAdd() {
    if (qty <= 0) return;
    if (qty > stock) {
      setFeedback(`Stock disponible : ${stock} kg max.`);
      return;
    }
    addToCart(ad, qty);
    setFeedback(`✓ ${qty} kg ajouté au panier`);
    window.setTimeout(() => setFeedback(null), 2500);
  }

  if (soldOut) {
    return (
      <div className="mt-4">
        <span className="inline-flex w-full items-center justify-center rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-500">
          Épuisé
        </span>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={stock}
          step={1}
          value={qty}
          onChange={(e) => setQty(Number(e.target.value))}
          className="w-20 rounded border border-neutral-200 px-2 py-1 text-sm"
          aria-label="Quantité (kg)"
        />
        <span className="text-xs text-neutral-500">kg</span>
        <button
          type="button"
          onClick={handleAdd}
          className="ml-auto rounded bg-leaf-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-leaf-700"
        >
          Ajouter au panier
        </button>
      </div>
      {feedback && (
        <p className="text-xs text-leaf-700">{feedback}</p>
      )}
    </div>
  );
}
