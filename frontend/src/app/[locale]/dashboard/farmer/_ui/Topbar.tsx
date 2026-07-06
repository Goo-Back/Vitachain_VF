import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { PlusIcon } from "./Icon";

/**
 * Topbar — quick action CTA + user pill.
 *
 * Kept intentionally light: no search affordance until there's a search
 * endpoint, no notifications bell until there's an alerts feed. Both can
 * slot back in once the backend supports them.
 */

export async function Topbar({
  userName,
  userInitials,
  showCreate = true,
}: {
  userName?: string | null;
  userInitials?: string;
  showCreate?: boolean;
}) {
  const t = await getTranslations("nav");
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-neutral-100 bg-white/70 px-4 backdrop-blur lg:px-8">
      <div className="w-10 lg:hidden" />

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        {showCreate ? (
          <Link
            href="/dashboard/farmer/parcels/new"
            className="vc-btn-primary"
          >
            <PlusIcon size={16} />
            <span className="hidden sm:inline">{t("farmer.newParcel")}</span>
          </Link>
        ) : null}

        <Link
          href="/dashboard/farmer/settings"
          className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white py-1.5 ps-1.5 pe-3 text-sm transition hover:border-sky-tint-500/50"
        >
          <span className="katara-gradient-strong grid h-7 w-7 place-items-center rounded-md text-xs font-semibold text-white">
            {userInitials ?? "·"}
          </span>
          <span className="hidden max-w-[8rem] truncate text-neutral-700 sm:inline">
            {userName ?? t("account")}
          </span>
        </Link>
      </div>
    </header>
  );
}
