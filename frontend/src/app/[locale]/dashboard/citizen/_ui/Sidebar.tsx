"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import Image from "next/image";
import { useEffect, useState } from "react";

import {
  ChevronRightIcon,
  HomeIcon,
  LogoutIcon,
  MenuIcon,
  SparkleIcon,
  StoreIcon,
  XIcon,
} from "@/app/[locale]/dashboard/farmer/_ui/Icon";
import { SecondServeLink } from "@/components/SecondServeLink";

type NavItem = {
  href: string;
  labelKey: "home" | "marketplace";
  icon: React.ComponentType<{ size?: number; className?: string }>;
  matchPrefix?: boolean;
};

const NAV: NavItem[] = [
  { href: "/dashboard/citizen", labelKey: "home", icon: HomeIcon },
  {
    href: "/dashboard/citizen/marketplace",
    labelKey: "marketplace",
    icon: StoreIcon,
    matchPrefix: true,
  },
];

function SidebarContent({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const t = useTranslations("nav.citizen");

  const isActive = (item: NavItem) => {
    if (item.href === "/dashboard/citizen") return pathname === item.href;
    if (item.matchPrefix) return pathname?.startsWith(item.href);
    return pathname === item.href;
  };

  return (
    <div className="flex h-full flex-col">
      <div className={`pt-5 pb-3 ${collapsed ? "px-3" : "px-5"}`}>
        <Link href="/dashboard/citizen" onClick={onNavigate} className="inline-flex">
          <Image
            src="/FarMarket1.png"
            alt="FarMarket"
            width={52}
            height={52}
            priority
            className="object-contain"
            style={{ width: 52, height: 52 }}
          />
        </Link>
      </div>

      <nav className={`flex-1 overflow-y-auto pb-6 ${collapsed ? "px-2" : "px-3"}`}>
        {!collapsed && (
          <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-neutral-400">
            {t("farmarketSection")}
          </p>
        )}
        <ul className="mt-1 space-y-0.5">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
            const label = t(item.labelKey);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  title={collapsed ? label : undefined}
                  className={`group relative flex items-center gap-3 rounded-lg py-2 text-sm transition ${
                    collapsed ? "justify-center px-2" : "px-3"
                  } ${
                    active
                      ? "bg-market-blue-50 font-medium text-market-blue-700"
                      : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                  }`}
                >
                  <Icon
                    size={18}
                    className={
                      active
                        ? "text-market-blue-600"
                        : "text-neutral-400 group-hover:text-neutral-600"
                    }
                  />
                  {!collapsed && <span className="flex-1 truncate">{label}</span>}
                  {!collapsed && active ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-market-blue-500" />
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* SecondServe is a separate origin (anti-gaspi marketplace); citizens
            browse surplus meals there. */}
        {!collapsed && (
          <p className="px-3 pt-5 pb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-neutral-400">
            {t("secondserveSection")}
          </p>
        )}
        <SecondServeLink
          path="/meals"
          className={`mt-1 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 py-2 text-sm font-medium text-amber-800 transition hover:border-amber-300 hover:bg-amber-100 ${
            collapsed ? "justify-center px-2" : "px-3"
          }`}
        >
          <SparkleIcon size={18} className="text-amber-500" />
          {!collapsed && <span className="flex-1 truncate">{t("surplusMeals")}</span>}
        </SecondServeLink>
      </nav>

      <div className={`border-t border-neutral-100 p-3 ${collapsed ? "px-2" : ""}`}>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            title={collapsed ? t("logout") : undefined}
            className={`flex w-full items-center gap-3 rounded-lg py-2 text-sm text-neutral-600 transition hover:bg-neutral-100 hover:text-danger-700 ${
              collapsed ? "justify-center px-2" : "px-3"
            }`}
          >
            <LogoutIcon size={18} className="text-neutral-400" />
            {!collapsed && t("logout")}
          </button>
        </form>
      </div>
    </div>
  );
}

export function Sidebar({
  collapsed = false,
  onToggleCollapsed,
}: {
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);
  const isRTL = useLocale() === "ar";

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
        aria-label={t("openMenu")}
        onClick={() => setOpen(true)}
        className="fixed start-3 top-3 z-30 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white shadow-card ring-1 ring-neutral-200 lg:hidden"
      >
        <MenuIcon size={20} className="text-neutral-700" />
      </button>

      <aside
        aria-label={t("mainNav")}
        className={`hidden lg:fixed lg:inset-y-0 lg:start-0 lg:z-20 lg:flex lg:flex-col lg:border-e lg:border-neutral-100 lg:bg-white/80 lg:backdrop-blur lg:transition-[width] lg:duration-300 lg:ease-out ${
          collapsed ? "lg:w-20" : "lg:w-64"
        }`}
      >
        <SidebarContent collapsed={collapsed} />

        {onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? t("expandMenu") : t("collapseMenu")}
            className="absolute -end-3 top-20 hidden h-6 w-6 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 shadow-sm transition-all duration-200 ease-out hover:border-market-blue-300 hover:text-market-blue-700 hover:shadow-md lg:flex"
          >
            <ChevronRightIcon
              size={14}
              className={`transition-transform duration-300 ease-out ${
                (isRTL ? !collapsed : collapsed) ? "" : "rotate-180"
              }`}
            />
          </button>
        )}
      </aside>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-neutral-900/40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 start-0 w-72 bg-white shadow-lifted">
            <button
              type="button"
              aria-label={t("closeMenu")}
              onClick={() => setOpen(false)}
              className="absolute end-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100"
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
