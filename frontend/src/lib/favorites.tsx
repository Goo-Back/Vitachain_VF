"use client";

/**
 * Client-side wishlist for the FarMarket restaurant flow.
 *
 * Each favorite stores a frozen snapshot of the ad at the moment it was
 * starred, so the favorites page can render without re-querying the catalog.
 * When the user opens an ad detail or adds it to the cart, the live API
 * value still wins — the snapshot is purely cosmetic.
 *
 * State lives in React + localStorage, mirroring the shape of `lib/cart.tsx`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { Ad } from "@/app/[locale]/dashboard/farmer/ads/actions";

const STORAGE_KEY = "vita_favorites_v1";

export type FavoriteAdSnapshot = Pick<
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

export type FavoriteEntry = {
  ad: FavoriteAdSnapshot;
  saved_at: string;
};

type FavoritesContextValue = {
  favorites: FavoriteEntry[];
  isFavorite: (ad_id: string) => boolean;
  toggleFavorite: (ad: FavoriteAdSnapshot) => void;
  removeFavorite: (ad_id: string) => void;
  clearFavorites: () => void;
  count: number;
};

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

function loadFromStorage(): FavoriteEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is FavoriteEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as FavoriteEntry).saved_at === "string" &&
        typeof (e as FavoriteEntry).ad === "object" &&
        typeof ((e as FavoriteEntry).ad as { id?: unknown }).id === "string",
    );
  } catch {
    return [];
  }
}

function saveToStorage(entries: FavoriteEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota / private mode — silently drop. Favorites stay in memory only.
  }
}

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const [favorites, setFavorites] = useState<FavoriteEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setFavorites(loadFromStorage());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveToStorage(favorites);
  }, [favorites, hydrated]);

  const isFavorite = useCallback(
    (ad_id: string) => favorites.some((f) => f.ad.id === ad_id),
    [favorites],
  );

  const toggleFavorite = useCallback<FavoritesContextValue["toggleFavorite"]>(
    (ad) => {
      setFavorites((prev) => {
        const exists = prev.findIndex((f) => f.ad.id === ad.id);
        if (exists >= 0) return prev.filter((_, i) => i !== exists);
        return [
          { ad, saved_at: new Date().toISOString() },
          ...prev,
        ];
      });
    },
    [],
  );

  const removeFavorite = useCallback<FavoritesContextValue["removeFavorite"]>(
    (ad_id) => {
      setFavorites((prev) => prev.filter((f) => f.ad.id !== ad_id));
    },
    [],
  );

  const clearFavorites = useCallback(() => setFavorites([]), []);

  const value = useMemo<FavoritesContextValue>(
    () => ({
      favorites,
      isFavorite,
      toggleFavorite,
      removeFavorite,
      clearFavorites,
      count: favorites.length,
    }),
    [favorites, isFavorite, toggleFavorite, removeFavorite, clearFavorites],
  );

  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites(): FavoritesContextValue {
  const ctx = useContext(FavoritesContext);
  if (!ctx) {
    throw new Error("useFavorites must be used inside <FavoritesProvider>");
  }
  return ctx;
}
