import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchMySubmissions } from "./actions";
import UploadForm from "./upload-form";

export const dynamic = "force-dynamic";

const STATUS_COPY: Record<"PENDING" | "APPROVED" | "REJECTED", string> = {
  PENDING:
    "Votre document est en cours de vérification. Vous recevrez un email dès qu’un administrateur l’aura validé.",
  APPROVED:
    "Votre profil est vérifié — vous pouvez désormais publier sur la marketplace.",
  REJECTED:
    "Votre document n’a pas été accepté. Vous pouvez en soumettre un nouveau ci-dessous.",
};

const DOCTYPE_COPY: Record<"RC" | "CIN" | "AGRI_CARD" | "OTHER", string> = {
  RC: "Registre de commerce",
  CIN: "Carte d’identité nationale",
  AGRI_CARD: "Carte d’agriculteur",
  OTHER: "Autre",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export default async function VerificationPage() {
  // AUTH-06 — gate the screen behind an authenticated session. The
  // middleware already redirects /onboarding/verification, but a direct
  // visit while signed out should land on /login, not crash on the API call.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/onboarding/verification");
  }

  const role = (user.app_metadata?.role ??
    user.user_metadata?.role ??
    "CITIZEN") as "FARMER" | "RESTAURANT" | "CITIZEN" | "ADMIN";

  if (role === "CITIZEN" || role === "ADMIN") {
    return (
      <main className="mx-auto max-w-xl p-8">
        <h1 className="mb-4 text-2xl font-semibold tracking-tight">
          Vérification professionnelle
        </h1>
        <p className="rounded border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
          Aucune vérification KYC requise pour votre rôle (
          {role === "ADMIN" ? "administrateur" : "citoyen"}).
        </p>
      </main>
    );
  }

  let submissions: Awaited<ReturnType<typeof fetchMySubmissions>>;
  try {
    submissions = await fetchMySubmissions();
  } catch {
    submissions = [];
  }
  const latest = submissions[0] ?? null;

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">
        Vérification professionnelle
      </h1>
      <p className="mb-6 text-sm text-neutral-600">
        Pour publier sur la marketplace, nous devons confirmer votre identité
        professionnelle. Téléversez un document parmi : registre de commerce,
        CIN, ou carte d’agriculteur.
      </p>

      {latest ? (
        <section
          role="status"
          className={`mb-6 rounded border p-4 text-sm ${
            latest.status === "APPROVED"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : latest.status === "REJECTED"
                ? "border-red-300 bg-red-50 text-red-900"
                : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          <p className="font-medium">{STATUS_COPY[latest.status]}</p>
          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-neutral-600">Document :</dt>
            <dd>{DOCTYPE_COPY[latest.document_type]}</dd>
            <dt className="text-neutral-600">Soumis le :</dt>
            <dd>{formatDate(latest.submitted_at)}</dd>
            {latest.reviewed_at ? (
              <>
                <dt className="text-neutral-600">Décision le :</dt>
                <dd>{formatDate(latest.reviewed_at)}</dd>
              </>
            ) : null}
            {latest.reviewer_note ? (
              <>
                <dt className="text-neutral-600">Motif :</dt>
                <dd>{latest.reviewer_note}</dd>
              </>
            ) : null}
          </dl>
          {latest.preview_url ? (
            <p className="mt-3 text-xs">
              <a
                href={latest.preview_url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Aperçu du document (lien temporaire)
              </a>
            </p>
          ) : null}
        </section>
      ) : null}

      {latest?.status === "APPROVED" ? (
        <a
          href={role === "FARMER" ? "/farmarket/new" : "/secondserve/new"}
          className="inline-block rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          {role === "FARMER"
            ? "Publier une annonce"
            : "Publier une surprise box"}
        </a>
      ) : (
        <UploadForm />
      )}
    </main>
  );
}
