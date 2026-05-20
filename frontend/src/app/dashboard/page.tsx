import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();

  // Middleware already enforces auth, but check again — defence in depth and a
  // friendlier TS narrowing for `user`.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // The role is NOT yet in the JWT claims — AUTH-02 adds a
  // custom_access_token_hook for that. Until then, owner-RLS on public.profiles
  // is the canonical read path.
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("full_name, role, verification_status, locale, email")
    .eq("id", user.id)
    .single<Pick<ProfileRow, "full_name" | "role" | "verification_status" | "locale" | "email">>();

  return (
    <main className="mx-auto max-w-2xl p-8">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          {/* TODO(i18n) */}
          Bonjour, {profile?.full_name ?? profile?.email ?? user.email}
        </h1>
        <form action="/auth/signout" method="post">
          <button type="submit" className="text-xs underline hover:text-emerald-700">
            Déconnexion
          </button>
        </form>
      </header>

      {error ? (
        <p className="mb-4 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800">
          Profil indisponible ({error.message}). Réessayez plus tard.
        </p>
      ) : null}

      <section className="rounded border border-neutral-200 bg-white p-4 text-sm shadow-sm">
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">Rôle</dt>
            <dd className="mt-1 font-medium">{profile?.role ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">Statut</dt>
            <dd className="mt-1 font-medium">{profile?.verification_status ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">Langue</dt>
            <dd className="mt-1 font-medium">{profile?.locale ?? "—"}</dd>
          </div>
        </dl>
      </section>

      {profile?.role === "FARMER" && (
        <section className="mt-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Module Katara
          </h2>
          {/* KAT-14 — the farmer-level overview at /dashboard/farmer is now
              the canonical entry point; the legacy /parcels list stays
              reachable for users with deep-link bookmarks. */}
          <Link
            href="/dashboard/farmer"
            className="block rounded border border-neutral-200 bg-white p-4 text-sm shadow-sm transition hover:border-emerald-300"
          >
            <p className="font-medium text-neutral-900">Mon exploitation</p>
            <p className="mt-0.5 text-neutral-600">
              Vue d&apos;ensemble de vos parcelles, capteurs et alertes.
            </p>
          </Link>
        </section>
      )}

      <p className="mt-8 text-sm text-neutral-500">
        {/* Other domain modules (FarMarket, SecondServe, Admin) plug in here. */}
        Les autres modules seront branchés dans les phases suivantes.
      </p>
    </main>
  );
}
