import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";

import { getServerProfile, getServerSession } from "@/lib/auth/session";

import { AdminNav } from "./AdminNav";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const session = await getServerSession();
  if (!session) return redirect({ href: "/login", locale });

  const profile = await getServerProfile();
  if (profile?.role !== "ADMIN") return redirect({ href: "/dashboard", locale });

  const t = await getTranslations("admin.shell");

  const displayName = profile.full_name ?? profile.email;

  return (
    <div className="min-h-screen bg-neutral-50">
      <aside className="fixed inset-y-0 start-0 z-20 flex w-56 flex-col border-e border-neutral-200 bg-white">
        <div className="flex h-16 items-center justify-between gap-2 border-b border-neutral-100 px-5">
          <span className="text-sm font-semibold tracking-tight text-neutral-900">
            VitaChain <span className="text-neutral-400">Admin</span>
          </span>
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
            {t("badge")}
          </span>
        </div>

        <AdminNav />

        <div className="border-t border-neutral-100 p-3">
          <p className="truncate px-3 py-1 text-xs text-neutral-500">
            {displayName}
          </p>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100 hover:text-red-700"
            >
              {t("signOut")}
            </button>
          </form>
        </div>
      </aside>

      <div className="ps-56">
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
