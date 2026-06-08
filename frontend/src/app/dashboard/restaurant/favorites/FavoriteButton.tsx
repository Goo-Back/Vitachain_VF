"use client";

import { useFavorites, type FavoriteAdSnapshot } from "@/lib/favorites";

type Props = {
  ad: FavoriteAdSnapshot;
  variant?: "icon" | "full";
};

export function FavoriteButton({ ad, variant = "icon" }: Props) {
  const { isFavorite, toggleFavorite } = useFavorites();
  const active = isFavorite(ad.id);

  if (variant === "full") {
    return (
      <button
        type="button"
        onClick={() => toggleFavorite(ad)}
        aria-pressed={active}
        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition ${
          active
            ? "border-red-200 bg-red-50 text-red-700"
            : "border-neutral-200 bg-white text-neutral-700 hover:border-leaf-300"
        }`}
      >
        <HeartGlyph filled={active} />
        {active ? "Retiré des favoris" : "Ajouter aux favoris"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFavorite(ad);
      }}
      aria-pressed={active}
      aria-label={active ? "Retirer des favoris" : "Ajouter aux favoris"}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-full backdrop-blur transition ${
        active
          ? "bg-red-500/90 text-white"
          : "bg-white/85 text-neutral-600 hover:bg-white"
      }`}
    >
      <HeartGlyph filled={active} />
    </button>
  );
}

function HeartGlyph({ filled }: { filled: boolean }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
    </svg>
  );
}
