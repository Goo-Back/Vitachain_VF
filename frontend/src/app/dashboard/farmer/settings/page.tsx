import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileRow } from "@/lib/supabase/types";

import {
  ArrowRightIcon,
  CheckCircleIcon,
  InfoIcon,
  LogoutIcon,
  SettingsIcon,
} from "../_ui/Icon";
import { PageHeader } from "../_ui/PageHeader";

/**
 * Paramètres · /dashboard/farmer/settings
 *
 * Minimal surface — only fields actually persisted in the profiles table
 * are shown. Notifications / 2FA / billing UI is intentionally absent
 * until those features ship a backend.
 *
 * The form is read-only for now: persistence requires a profile_update
 * server action that doesn't yet exist. Switching to read-write only
 * needs an action + form binding here.
 */

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, role, locale, verification_status")
    .eq("id", user.id)
    .single<
      Pick<
        ProfileRow,
        "full_name" | "email" | "role" | "locale" | "verification_status"
      >
    >();

  const isVerified = profile?.verification_status === "VERIFIED";
  const localeLabel =
    profile?.locale === "ar" ? "العربية" : profile?.locale === "en" ? "English" : "Français";

  return (
    <div className="mx-auto max-w-3xl vc-fade-in">
      <PageHeader
        crumbs={[
          { label: "Mon exploitation", href: "/dashboard/farmer" },
          { label: "Paramètres" },
        ]}
        eyebrow="Paramètres"
        title="Votre compte."
        subtitle="Informations de profil et statut de vérification."
      />

      <div className="space-y-6">
        {/* Profil */}
        <SectionCard
          icon={<SettingsIcon size={18} className="text-leaf-700" />}
          title="Profil"
        >
          <dl className="grid gap-4 sm:grid-cols-2">
            <Row label="Nom" value={profile?.full_name ?? "—"} />
            <Row label="Email" value={profile?.email ?? user.email ?? "—"} />
            <Row label="Rôle" value={profile?.role ?? "—"} />
            <Row label="Langue" value={localeLabel} />
          </dl>
        </SectionCard>

        {/* Vérification */}
        <SectionCard
          icon={<CheckCircleIcon size={18} className="text-leaf-700" />}
          title="Vérification d'identité"
        >
          <div
            className={`flex items-start gap-3 rounded-lg p-4 ${
              isVerified
                ? "bg-leaf-50 ring-1 ring-leaf-200"
                : "bg-warn-50 ring-1 ring-warn-500/30"
            }`}
          >
            {isVerified ? (
              <CheckCircleIcon size={20} className="mt-0.5 text-leaf-700" />
            ) : (
              <InfoIcon size={20} className="mt-0.5 text-warn-700" />
            )}
            <div className="flex-1">
              <p
                className={`text-sm font-semibold ${
                  isVerified ? "text-leaf-800" : "text-warn-700"
                }`}
              >
                {isVerified
                  ? "Compte vérifié"
                  : profile?.verification_status === "PENDING"
                    ? "Vérification en cours"
                    : "Vérification requise"}
              </p>
              <p className="mt-1 text-sm text-neutral-700">
                {isVerified
                  ? "Vous pouvez appairer des capteurs et enregistrer des parcelles."
                  : "L'appairage d'un capteur et la création d'une parcelle nécessitent la vérification de votre identité."}
              </p>
              {!isVerified ? (
                <Link
                  href="/onboarding/verification"
                  className="vc-btn-primary mt-3"
                >
                  Soumettre mes documents <ArrowRightIcon size={14} />
                </Link>
              ) : null}
            </div>
          </div>
        </SectionCard>

        {/* Déconnexion */}
        <SectionCard
          icon={<LogoutIcon size={18} className="text-neutral-500" />}
          title="Session"
        >
          <form action="/auth/signout" method="post">
            <button type="submit" className="vc-btn-ghost">
              <LogoutIcon size={14} /> Se déconnecter
            </button>
          </form>
        </SectionCard>
      </div>
    </div>
  );
}

function SectionCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="vc-card p-6">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-leaf-50">
          {icon}
        </span>
        <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-neutral-900">{value}</dd>
    </div>
  );
}
