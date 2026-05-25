"use client";

/**
 * FAR-03 — client-side cart for the FarMarket logistics-intermediary flow.
 *
 * State lives in React + localStorage; the server only sees it at order-
 * placement time when the cart payload is POSTed to /api/v1/farmarket/orders.
 * The backend re-validates each ad's status, stock, and pricing before
 * committing the order, so a stale cart can only cause a 409 — never an
 * incorrect order.
 *
 * Snapshot shape: each cart line keeps a frozen copy of the ad row at the
 * moment it was added (title, price, region, producer name, etc.) so the
 * UI can render without re-fetching even if the ad is later edited or
 * removed. The server still uses live ad data for pricing — the snapshot
 * is render-only.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { Ad } from "@/app/dashboard/farmer/ads/actions";

const STORAGE_KEY = "vita_cart_v1";

export type CartLine = {
  ad_id: string;
  quantity_kg: number;
  ad_snapshot: Pick<
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

type CartContextValue = {
  lines: CartLine[];
  addToCart: (ad: CartLine["ad_snapshot"], quantity_kg: number) => void;
  updateQuantity: (ad_id: string, quantity_kg: number) => void;
  removeFromCart: (ad_id: string) => void;
  clearCart: () => void;
  itemCount: number;
  subtotal: number;
};

const CartContext = createContext<CartContextValue | null>(null);

function loadFromStorage(): CartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Defensive: shape-check each line.
    return parsed.filter(
      (l): l is CartLine =>
        typeof l === "object" &&
        l !== null &&
        typeof (l as CartLine).ad_id === "string" &&
        typeof (l as CartLine).quantity_kg === "number" &&
        typeof (l as CartLine).ad_snapshot === "object",
    );
  } catch {
    return [];
  }
}

function saveToStorage(lines: CartLine[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // Quota or private-mode — ignore. The cart will live for the session only.
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage exactly once on mount.
  useEffect(() => {
    setLines(loadFromStorage());
    setHydrated(true);
  }, []);

  // Persist on every change (after hydration to avoid wiping on first render).
  useEffect(() => {
    if (hydrated) saveToStorage(lines);
  }, [lines, hydrated]);

  const addToCart = useCallback<CartContextValue["addToCart"]>(
    (ad, quantity_kg) => {
      setLines((prev) => {
        const existing = prev.findIndex((l) => l.ad_id === ad.id);
        if (existing >= 0) {
          const next = [...prev];
          next[existing] = {
            ...next[existing],
            quantity_kg: next[existing].quantity_kg + quantity_kg,
          };
          return next;
        }
        return [
          ...prev,
          { ad_id: ad.id, quantity_kg, ad_snapshot: ad },
        ];
      });
    },
    [],
  );

  const updateQuantity = useCallback<CartContextValue["updateQuantity"]>(
    (ad_id, quantity_kg) => {
      setLines((prev) =>
        prev.map((l) =>
          l.ad_id === ad_id ? { ...l, quantity_kg } : l,
        ),
      );
    },
    [],
  );

  const removeFromCart = useCallback<CartContextValue["removeFromCart"]>(
    (ad_id) => {
      setLines((prev) => prev.filter((l) => l.ad_id !== ad_id));
    },
    [],
  );

  const clearCart = useCallback(() => setLines([]), []);

  const subtotal = useMemo(
    () =>
      lines.reduce(
        (acc, l) => acc + l.quantity_kg * Number(l.ad_snapshot.price_mad),
        0,
      ),
    [lines],
  );

  const itemCount = lines.length;

  const value: CartContextValue = useMemo(
    () => ({
      lines,
      addToCart,
      updateQuantity,
      removeFromCart,
      clearCart,
      itemCount,
      subtotal,
    }),
    [lines, addToCart, updateQuantity, removeFromCart, clearCart, itemCount, subtotal],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error("useCart must be used inside <CartProvider>");
  }
  return ctx;
}

/** Logistics fee — must match `compute_logistics_fee` in the backend. */
export function computeLogisticsFee(subtotal: number): number {
  return Math.max(50, Math.round(subtotal * 0.05 * 100) / 100);
}
