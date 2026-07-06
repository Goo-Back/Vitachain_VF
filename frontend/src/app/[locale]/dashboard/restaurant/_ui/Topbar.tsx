"use client";

import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

import { ChevronDownIcon, ShoppingBagIcon } from "@/app/[locale]/dashboard/farmer/_ui/Icon";
import { useCart } from "@/lib/cart";

type Props = {
  userName?: string | null;
  userInitials?: string;
};

export function Topbar({ userName, userInitials }: Props) {
  const t = useTranslations("nav");
  const { itemCount, subtotal } = useCart();

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-neutral-100 bg-white/70 px-4 backdrop-blur lg:px-8">
      <div className="w-10 lg:hidden" />

      <div className="ms-auto flex items-center gap-2.5">
        <Link
          href="/dashboard/restaurant/cart"
          className="relative inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white py-1.5 px-3.5 text-sm shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-market-blue-300 hover:shadow-md"
          aria-label={t("restaurant.viewCart")}
        >
          <ShoppingBagIcon size={16} className="text-neutral-500" />
          <span className="hidden sm:inline font-medium text-neutral-700">
            {subtotal.toFixed(0)} MAD
          </span>
          {itemCount > 0 ? (
            <span className="absolute -end-1 -top-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-market-blue-600 px-1 text-[10px] font-semibold text-white shadow-sm">
              {itemCount > 99 ? "99+" : itemCount}
            </span>
          ) : null}
        </Link>

        <Link
          href="/dashboard/restaurant/settings"
          className="group inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white py-1 ps-1 pe-3 shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-market-blue-300 hover:shadow-md"
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-market-blue-400 to-leaf-600 text-xs font-semibold text-white shadow-sm ring-2 ring-white">
            {userInitials ?? "·"}
          </span>
          <span className="hidden max-w-[8rem] truncate text-sm font-medium text-neutral-700 sm:inline">
            {userName ?? t("account")}
          </span>
          <ChevronDownIcon
            size={14}
            className="hidden text-neutral-400 transition-colors duration-200 group-hover:text-market-blue-600 sm:inline"
          />
        </Link>
      </div>
    </header>
  );
}
