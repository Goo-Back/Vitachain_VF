import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileRow } from "@/lib/supabase/types";
import { SecondServeLink } from "@/components/SecondServeLink";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();

  // Middleware already enforces auth, but check again — defence in depth and a
  // friendlier TS narrowing for `user`.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;
  if (!user) redirect("/login");

  // The role is NOT yet in the JWT claims — AUTH-02 adds a
  // custom_access_token_hook for that. Until then, owner-RLS on public.profiles
  // is the canonical read path.
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("full_name, role, verification_status, locale, email")
    .eq("id", user.id)
    .maybeSingle<Pick<ProfileRow, "full_name" | "role" | "verification_status" | "locale" | "email">>();

  // No VitaChain profile for this authenticated user. This happens when a
  // SecondServe-only account (shared auth pool, no public.profiles row — see
  // migration 0048) navigates to the VitaChain app. Render a clear dead-end
  // with sign-out rather than a half-broken dashboard with empty role sections.
  if (!error && !profile) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Compte non reconnu sur VitaChain</h1>
        <p className="mt-3 text-sm text-neutral-600">
          Ce compte ({user.email}) n&apos;a pas de profil VitaChain. Il appartient
          peut-être à une autre application (SecondServe). Connectez-vous avec un
          compte VitaChain, ou déconnectez-vous.
        </p>
        <form action="/auth/signout" method="post" className="mt-6">
          <button
            type="submit"
            className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
          >
            Déconnexion
          </button>
        </form>
      </main>
    );
  }

  // Skip the role-picker hub: send each role straight to its home surface.
  // CITIZEN has no in-app dashboard (SecondServe is a separate origin), so it
  // falls through to the overview below, which keeps the SecondServe link.
  if (profile?.role === "FARMER") redirect("/dashboard/farmer");
  if (profile?.role === "RESTAURANT") redirect("/dashboard/restaurant/marketplace");
  if (profile?.role === "ADMIN") redirect("/dashboard/admin");

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

      {/* FARMER / RESTAURANT / ADMIN are redirected above to their own home
          surface, so only CITIZEN (no in-app dashboard) renders this overview.
          SecondServe is a separate origin; the link opens in a new tab so the
          VitaChain session is preserved. */}
      {profile?.role === "CITIZEN" && (
        <section className="mt-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Module SecondServe
          </h2>
          <SecondServeLink
            path="/meals"
            className="block rounded border border-neutral-200 bg-white p-4 text-sm shadow-sm transition hover:border-emerald-300"
          >
            <p className="font-medium text-neutral-900">
              Sauver des repas anti-gaspi
            </p>
            <p className="mt-0.5 text-neutral-600">
              Accédez à SecondServe avec votre compte VitaChain — connexion automatique.
            </p>
          </SecondServeLink>
        </section>
      )}

      <p className="mt-8 text-sm text-neutral-500">
        {/* Other domain modules (FarMarket, Admin) plug in here. */}
        Les autres modules seront branchés dans les phases suivantes.
      </p>
    </main>
  );
}
