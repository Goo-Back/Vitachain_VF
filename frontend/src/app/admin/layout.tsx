import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/kyc");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name, email")
    .eq("id", user.id)
    .single<Pick<ProfileRow, "role" | "full_name" | "email">>();

  if (profile?.role !== "ADMIN") redirect("/dashboard");

  const displayName = profile?.full_name ?? profile?.email ?? user.email ?? "Admin";

  return (
    <div className="min-h-screen bg-neutral-50">
      <aside className="fixed inset-y-0 left-0 z-20 flex w-56 flex-col border-r border-neutral-200 bg-white">
        <div className="flex h-16 items-center px-5 border-b border-neutral-100">
          <span className="text-sm font-semibold tracking-tight text-neutral-900">
            VitaChain <span className="text-neutral-400">Admin</span>
          </span>
        </div>
        <nav className="flex-1 px-3 py-4">
          <a
            href="/admin/kyc"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
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
              className="text-neutral-500"
              aria-hidden="true"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            File KYC
          </a>
        </nav>
        <div className="border-t border-neutral-100 p-3">
          <p className="px-3 py-1 text-xs text-neutral-500 truncate">{displayName}</p>
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
        <main className="px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
