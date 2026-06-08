"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { SearchIcon, ShoppingBagIcon } from "@/app/dashboard/farmer/_ui/Icon";
import { useCart } from "@/lib/cart";

type Props = {
  userName?: string | null;
  userInitials?: string;
};

export function Topbar({ userName, userInitials }: Props) {
  const router = useRouter();
  const { itemCount, subtotal } = useCart();
  const [q, setQ] = useState("");

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const term = q.trim();
    const qs = new URLSearchParams();
    if (term) qs.set("product_type", term);
    router.push(`/dashboard/restaurant/marketplace?${qs.toString()}`);
  }

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-neutral-100 bg-white/70 px-4 backdrop-blur lg:px-8">
      <div className="w-10 lg:hidden" />

      <form onSubmit={onSubmit} className="flex-1 max-w-md">
        <label htmlFor="resto-search" className="sr-only">
          Rechercher un produit
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
            <SearchIcon size={16} />
          </span>
          <input
            id="resto-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher un produit (tomates, oignons…)"
            className="w-full rounded-lg border border-neutral-200 bg-white py-1.5 pl-9 pr-3 text-sm focus:border-leaf-400 focus:outline-none focus:ring-2 focus:ring-leaf-200"
          />
        </div>
      </form>

      <div className="flex items-center gap-2">
        <Link
          href="/dashboard/restaurant/cart"
          className="relative inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white py-1.5 px-3 text-sm transition hover:border-leaf-300"
          aria-label="Voir le panier"
        >
          <ShoppingBagIcon size={16} className="text-neutral-500" />
          <span className="hidden sm:inline text-neutral-700">
            {subtotal.toFixed(0)} MAD
          </span>
          {itemCount > 0 ? (
            <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-leaf-600 px-1 text-[10px] font-semibold text-white">
              {itemCount > 99 ? "99+" : itemCount}
            </span>
          ) : null}
        </Link>

        <Link
          href="/dashboard/restaurant/settings"
          className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white py-1.5 pl-1.5 pr-3 text-sm transition hover:border-leaf-300"
        >
          <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-leaf-500 to-leaf-700 text-xs font-semibold text-white">
            {userInitials ?? "·"}
          </span>
          <span className="hidden max-w-[8rem] truncate text-neutral-700 sm:inline">
            {userName ?? "Mon compte"}
          </span>
        </Link>
      </div>
    </header>
  );
}
