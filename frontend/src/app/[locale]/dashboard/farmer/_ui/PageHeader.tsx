import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

import { ChevronRightIcon } from "./Icon";

/**
 * Generic page header used across new pages (alerts, weather, etc.):
 * eyebrow + title + supporting subtitle + optional CTA slot,
 * with optional breadcrumb crumbs.
 */

export type Crumb = { label: string; href?: string };

export async function PageHeader({
  eyebrow,
  title,
  subtitle,
  crumbs,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  crumbs?: Crumb[];
  actions?: React.ReactNode;
}) {
  const t = await getTranslations("farmer.common");
  return (
    <header className="mb-10">
      {crumbs && crumbs.length > 0 ? (
        <nav
          aria-label={t("breadcrumbAriaLabel")}
          className="mb-3 flex flex-wrap items-center gap-1 text-xs text-neutral-500"
        >
          {crumbs.map((c, i) => (
            <span key={`${c.label}-${i}`} className="flex items-center gap-1">
              {c.href ? (
                <Link href={c.href} className="hover:text-leaf-700">
                  {c.label}
                </Link>
              ) : (
                <span className="text-neutral-700">{c.label}</span>
              )}
              {i < crumbs.length - 1 ? (
                <ChevronRightIcon size={12} className="rtl:-scale-x-100 text-neutral-300" />
              ) : null}
            </span>
          ))}
        </nav>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {eyebrow ? <p className="vc-eyebrow">{eyebrow}</p> : null}
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-neutral-500">{subtitle}</p>
          ) : null}
        </div>
        {actions ? <div className="flex gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
