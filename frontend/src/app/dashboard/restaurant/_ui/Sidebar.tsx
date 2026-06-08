"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import {
  BellIcon,
  HomeIcon,
  InfoIcon,
  LogoutIcon,
  MenuIcon,
  PackageIcon,
  SettingsIcon,
  ShoppingBagIcon,
  SparkleIcon,
  StoreIcon,
  XIcon,
} from "@/app/dashboard/farmer/_ui/Icon";
import { Logo } from "@/app/dashboard/farmer/_ui/Logo";
import { useCart } from "@/lib/cart";
import { useFavorites } from "@/lib/favorites";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  matchPrefix?: boolean;
  badge?: "cart" | "favorites";
};

const NAV: NavItem[] = [
  { href: "/dashboard/restaurant", label: "Vue d'ensemble", icon: HomeIcon },
  {
    href: "/dashboard/restaurant/marketplace",
    label: "Catalogue",
    icon: StoreIcon,
    matchPrefix: true,
  },
  {
    href: "/dashboard/restaurant/favorites",
    label: "Favoris",
    icon: SparkleIcon,
    badge: "favorites",
  },
  {
    href: "/dashboard/restaurant/cart",
    label: "Panier",
    icon: ShoppingBagIcon,
    badge: "cart",
  },
  {
    href: "/dashboard/restaurant/orders",
    label: "Mes commandes",
    icon: PackageIcon,
    matchPrefix: true,
  },
  {
    href: "/dashboard/restaurant/help",
    label: "Aide",
    icon: InfoIcon,
  },
];

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-leaf-600 px-1.5 text-[10px] font-semibold text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { itemCount } = useCart();
  const { count: favCount } = useFavorites();

  const isActive = (item: NavItem) => {
    if (item.href === "/dashboard/restaurant") return pathname === item.href;
    if (item.matchPrefix) return pathname?.startsWith(item.href);
    return pathname === item.href;
  };

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pt-5 pb-3">
        <Link
          href="/dashboard/restaurant"
          onClick={onNavigate}
          className="inline-flex"
        >
          <Logo size="sm" />
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-6">
        <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-neutral-400">
          FarMarket
        </p>
        <ul className="mt-1 space-y-0.5">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
            const badgeCount =
              item.badge === "cart"
                ? itemCount
                : item.badge === "favorites"
                  ? favCount
                  : 0;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                    active
                      ? "bg-leaf-50 font-medium text-leaf-800"
                      : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                  }`}
                >
                  <Icon
                    size={18}
                    className={
                      active
                        ? "text-leaf-600"
                        : "text-neutral-400 group-hover:text-neutral-600"
                    }
                  />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.badge ? (
                    <Badge count={badgeCount} />
                  ) : active ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-leaf-500" />
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-neutral-100 p-3">
        <Link
          href="/dashboard/restaurant/notifications"
          onClick={onNavigate}
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
            pathname?.startsWith("/dashboard/restaurant/notifications")
              ? "bg-leaf-50 font-medium text-leaf-800"
              : "text-neutral-600 hover:bg-neutral-100"
          }`}
        >
          <BellIcon size={18} className="text-neutral-400" />
          Notifications
        </Link>
        <Link
          href="/dashboard/restaurant/settings"
          onClick={onNavigate}
          className={`mt-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
            pathname?.startsWith("/dashboard/restaurant/settings")
              ? "bg-leaf-50 font-medium text-leaf-800"
              : "text-neutral-600 hover:bg-neutral-100"
          }`}
        >
          <SettingsIcon size={18} className="text-neutral-400" />
          Paramètres
        </Link>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-neutral-600 transition hover:bg-neutral-100 hover:text-danger-700"
          >
            <LogoutIcon size={18} className="text-neutral-400" />
            Déconnexion
          </button>
        </form>
      </div>
    </div>
  );
}

export function Sidebar() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label="Ouvrir la navigation"
        onClick={() => setOpen(true)}
        className="fixed left-3 top-3 z-30 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white shadow-card ring-1 ring-neutral-200 lg:hidden"
      >
        <MenuIcon size={20} className="text-neutral-700" />
      </button>

      <aside
        aria-label="Navigation principale"
        className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-20 lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-neutral-100 lg:bg-white/80 lg:backdrop-blur"
      >
        <SidebarContent />
      </aside>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-neutral-900/40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-72 bg-white shadow-lifted">
            <button
              type="button"
              aria-label="Fermer la navigation"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100"
            >
              <XIcon size={18} />
            </button>
            <SidebarContent onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}
