"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import {
  ChartIcon,
  CloudIcon,
  HomeIcon,
  LogoutIcon,
  MenuIcon,
  SatelliteIcon,
  SettingsIcon,
  XIcon,
} from "./Icon";
import { Logo } from "./Logo";

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
 * Mobile (<lg): hidden behind a hamburger drawer; the drawer state is held
 * in a small client wrapper so everything else can stay server-rendered.
 */

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  matchPrefix?: boolean;
};

const NAV: NavItem[] = [
  { href: "/dashboard/farmer", label: "Vue d'ensemble", icon: HomeIcon },
  {
    href: "/dashboard/farmer/parcels",
    label: "Mes parcelles",
    icon: ChartIcon,
    matchPrefix: true,
  },
  { href: "/dashboard/farmer/weather", label: "Météo", icon: CloudIcon },
  { href: "/dashboard/farmer/satellite", label: "Satellite", icon: SatelliteIcon },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

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
          <Logo size="sm" />
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
                  {active ? (
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
          href="/dashboard/farmer/settings"
          onClick={onNavigate}
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
            pathname?.startsWith("/dashboard/farmer/settings")
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
