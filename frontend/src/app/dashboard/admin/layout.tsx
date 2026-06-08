import { redirect } from "next/navigation";

import { getServerProfile, getServerSession } from "@/lib/auth/session";

import { AdminNav } from "./AdminNav";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const profile = await getServerProfile();
  if (profile?.role !== "ADMIN") redirect("/dashboard");

  const displayName = profile.full_name ?? profile.email;

  return (
    <div className="min-h-screen bg-neutral-50">
      <aside className="fixed inset-y-0 left-0 z-20 flex w-56 flex-col border-r border-neutral-200 bg-white">
        <div className="flex h-16 items-center justify-between gap-2 border-b border-neutral-100 px-5">
          <span className="text-sm font-semibold tracking-tight text-neutral-900">
            VitaChain <span className="text-neutral-400">Admin</span>
          </span>
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
            ADMIN
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
              Déconnexion
            </button>
          </form>
        </div>
      </aside>

      <div className="pl-56">
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
