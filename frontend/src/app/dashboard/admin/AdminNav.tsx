"use client";

import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
};

const ITEMS: NavItem[] = [
  {
    href: "/dashboard/admin/verifications",
    label: "Vérifications KYC",
    icon: (
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2 14 8 20 8 M16 13 8 13 M16 17 8 17 M10 9 9 9 8 9" />
    ),
  },
  {
    href: "/dashboard/admin/users",
    label: "Utilisateurs",
    icon: (
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 7a4 4 0 1 0 0 0.01 M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75" />
    ),
  },
  {
    href: "/dashboard/admin/farmarket",
    label: "FarMarket",
    icon: (
      <path d="M3 9 5 3h14l2 6 M3 9v11a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9 M3 9h18 M9 13h6" />
    ),
  },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex-1 space-y-1 px-3 py-4">
      {ITEMS.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <a
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-rose-50 text-rose-700"
                : "text-neutral-700 hover:bg-neutral-100"
            }`}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={active ? "text-rose-600" : "text-neutral-500"}
              aria-hidden="true"
            >
              {item.icon}
            </svg>
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
