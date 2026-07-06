"use client";

import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { useEffect, useState } from "react";

import {
  CloudIcon,
  HomeIcon,
  LogoutIcon,
  MapIcon,
  MenuIcon,
  PackageIcon,
  SatelliteIcon,
  SettingsIcon,
  StoreIcon,
  XIcon,
} from "./Icon";
import { KataraLogo } from "./KataraLogo";

/**
 * Vertical navigation rail used across every /dashboard/farmer/* route.
 *
 * Only routes backed by a real data source live here:
 *   - Vue d'ensemble + Mes parcelles → Katara backend (/katara/...)
 *   - Météo → OpenWeatherMap (server-side, via OPENWEATHERMAP_API_KEY)
 *   - Satellite → Sentinel Hub (server-side, via SENTINEL_HUB_API_KEY)
 * The AI diagnostic lives on the parcel detail page (KAT-07
 * DiagnosticSection) — the worker calls Gemini async with caching,
 * rate-limit and email notification, which is the canonical path.
 * Settings is pinned at the bottom because it's account-level, not
 * exploitation-level.
 *
 * Motion: the active item carries a shared-layout highlight that slides
 * between rows (`layoutId`), and the mobile drawer animates in/out with
 * AnimatePresence. Branding is Katara (farmer-scoped).
 *
 * Mobile (<lg): hidden behind a hamburger drawer; the drawer state is held
 * in a small client wrapper so everything else can stay server-rendered.
 */

type NavItem = {
  href: string;
  labelKey: "overview" | "parcels" | "ads" | "orders" | "weather" | "satellite";
  icon: React.ComponentType<{ size?: number; className?: string }>;
  matchPrefix?: boolean;
};

const NAV: NavItem[] = [
  { href: "/dashboard/farmer", labelKey: "overview", icon: HomeIcon },
  {
    href: "/dashboard/farmer/parcels",
    labelKey: "parcels",
    icon: MapIcon,
    matchPrefix: true,
  },
  {
    href: "/dashboard/farmer/ads",
    labelKey: "ads",
    icon: StoreIcon,
    matchPrefix: true,
  },
  {
    href: "/dashboard/farmer/orders",
    labelKey: "orders",
    icon: PackageIcon,
    matchPrefix: true,
  },
  { href: "/dashboard/farmer/weather", labelKey: "weather", icon: CloudIcon },
  { href: "/dashboard/farmer/satellite", labelKey: "satellite", icon: SatelliteIcon },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const t = useTranslations("nav.farmer");

  const isActive = (item: NavItem) => {
    if (item.matchPrefix) return pathname?.startsWith(item.href);
    return pathname === item.href;
  };

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pt-5 pb-3">
        <Link
          href="/dashboard/farmer"
          onClick={onNavigate}
          className="inline-flex"
        >
          <KataraLogo size="sm" />
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-6">
        <ul className="mt-2 space-y-0.5">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                    active
                      ? "font-medium text-sky-tint-700"
                      : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                  }`}
                >
                  {active ? (
                    <motion.span
                      layoutId="farmer-nav-active"
                      transition={{ type: "spring", stiffness: 500, damping: 40 }}
                      className="absolute inset-0 -z-0 rounded-lg bg-sky-tint-50"
                    />
                  ) : null}
                  <Icon
                    size={18}
                    className={`relative z-10 ${
                      active
                        ? "text-sky-tint-700"
                        : "text-neutral-400 group-hover:text-neutral-600"
                    }`}
                  />
                  <span className="relative z-10 flex-1 truncate">{t(item.labelKey)}</span>
                  {active ? (
                    <span className="relative z-10 h-1.5 w-1.5 rounded-full bg-sky-tint-500" />
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-neutral-100 p-3">
        <Link
          href="/dashboard/farmer/settings"
          onClick={onNavigate}
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
            pathname?.startsWith("/dashboard/farmer/settings")
              ? "bg-sky-tint-50 font-medium text-sky-tint-700"
              : "text-neutral-600 hover:bg-neutral-100"
          }`}
        >
          <SettingsIcon size={18} className="text-neutral-400" />
          {t("settings")}
        </Link>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-neutral-600 transition hover:bg-neutral-100 hover:text-danger-700"
          >
            <LogoutIcon size={18} className="text-neutral-400" />
            {t("logout")}
          </button>
        </form>
      </div>
    </div>
  );
}

export function Sidebar() {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);
  // Framer Motion's `x` transform is a physical-axis offset (px/%), so unlike
  // the Tailwind logical-property classes below (start-/end-), it does not
  // auto-flip with `dir="rtl"` — the drawer must slide in from whichever edge
  // is the inline-start for the current locale.
  const isRTL = useLocale() === "ar";
  const offscreenX = isRTL ? "100%" : "-100%";

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label={t("openMenu")}
        onClick={() => setOpen(true)}
        className="fixed start-3 top-3 z-30 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white shadow-card ring-1 ring-neutral-200 lg:hidden"
      >
        <MenuIcon size={20} className="text-neutral-700" />
      </button>

      <aside
        aria-label={t("mainNav")}
        className="hidden lg:fixed lg:inset-y-0 lg:start-0 lg:z-20 lg:flex lg:w-64 lg:flex-col lg:border-e lg:border-neutral-100 lg:bg-white/80 lg:backdrop-blur"
      >
        <SidebarContent />
      </aside>

      <AnimatePresence>
        {open ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <motion.div
              aria-hidden="true"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 bg-neutral-900/40"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ x: offscreenX }}
              animate={{ x: 0 }}
              exit={{ x: offscreenX }}
              transition={{ type: "spring", stiffness: 380, damping: 38 }}
              className="absolute inset-y-0 start-0 w-72 bg-white shadow-lifted"
            >
              <button
                type="button"
                aria-label={t("closeMenu")}
                onClick={() => setOpen(false)}
                className="absolute end-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100"
              >
                <XIcon size={18} />
              </button>
              <SidebarContent onNavigate={() => setOpen(false)} />
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
