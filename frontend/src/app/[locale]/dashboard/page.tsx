import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const locale = await getLocale();
  const t = await getTranslations("dashboardRoot");
  const supabase = await createSupabaseServerClient();

  // Middleware already enforces auth, but check again — defence in depth and a
  // friendlier TS narrowing for `user`.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;
  if (!user) return redirect({ href: "/login", locale });

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
        <h1 className="text-2xl font-semibold tracking-tight">{t("unknownAccountTitle")}</h1>
        <p className="mt-3 text-sm text-neutral-600">
          {t("unknownAccountBody", { email: user.email ?? "" })}
        </p>
        <form action="/auth/signout" method="post" className="mt-6">
          <button
            type="submit"
            className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
          >
            {t("logout")}
          </button>
        </form>
      </main>
    );
  }

  // Skip the role-picker hub: send each role straight to its home surface.
  if (profile?.role === "FARMER") return redirect({ href: "/dashboard/farmer", locale });
  if (profile?.role === "RESTAURANT") {
    return redirect({ href: "/dashboard/restaurant/marketplace", locale });
  }
  if (profile?.role === "ADMIN") return redirect({ href: "/dashboard/admin", locale });
  // Citizens live in SecondServe; auto-redirect them there.
  if (profile?.role === "CITIZEN") return redirect({ href: "/dashboard/citizen", locale });

  return (
    <main className="mx-auto max-w-2xl p-8">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("greeting", { name: profile?.full_name ?? profile?.email ?? user.email ?? "" })}
        </h1>
        <form action="/auth/signout" method="post">
          <button type="submit" className="text-xs underline hover:text-emerald-700">
            {t("logout")}
          </button>
        </form>
      </header>

      {error ? (
        <p className="mb-4 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800">
          {t("profileUnavailable", { message: error.message })}
        </p>
      ) : null}

      <section className="rounded border border-neutral-200 bg-white p-4 text-sm shadow-sm">
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">{t("role")}</dt>
            <dd className="mt-1 font-medium">{profile?.role ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">{t("status")}</dt>
            <dd className="mt-1 font-medium">{profile?.verification_status ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">{t("language")}</dt>
            <dd className="mt-1 font-medium">{profile?.locale ?? "—"}</dd>
          </div>
        </dl>
      </section>

      <p className="mt-8 text-sm text-neutral-500">
        {/* Other domain modules (FarMarket, Admin) plug in here. */}
        {t("otherModules")}
      </p>
    </main>
  );
}
