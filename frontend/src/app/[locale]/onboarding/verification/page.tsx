import { getLocale, getTranslations } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toIntlLocale } from "@/lib/intlLocale";
import { SecondServeLink } from "@/components/SecondServeLink";
import { fetchMySubmissions } from "./actions";
import UploadForm from "./upload-form";

export const dynamic = "force-dynamic";

const STATUS_KEY: Record<"PENDING" | "APPROVED" | "REJECTED", string> = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
};

const DOCTYPE_KEY: Record<"RC" | "CIN" | "AGRI_CARD" | "OTHER", string> = {
  RC: "rc",
  CIN: "cin",
  AGRI_CARD: "agriCard",
  OTHER: "other",
};

function formatDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export default async function VerificationPage() {
  const t = await getTranslations("onboarding.verification");
  // AUTH-06 — gate the screen behind an authenticated session. The
  // middleware already redirects /onboarding/verification, but a direct
  // visit while signed out should land on /login, not crash on the API call.
  const locale = await getLocale();
  const intlLocale = toIntlLocale(locale);
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;
  if (!user) {
    return redirect({ href: "/login?next=/onboarding/verification", locale });
  }

  const role = (user.app_metadata?.role ??
    user.user_metadata?.role ??
    "CITIZEN") as "FARMER" | "RESTAURANT" | "CITIZEN" | "ADMIN";

  if (role === "CITIZEN" || role === "ADMIN") {
    return (
      <main className="mx-auto max-w-xl p-8">
        <h1 className="mb-4 text-2xl font-semibold tracking-tight">
          {t("heading")}
        </h1>
        <p className="rounded border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
          {t("noKycRequired", {
            role: role === "ADMIN" ? t("roleAdmin") : t("roleCitizen"),
          })}
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
        {t("heading")}
      </h1>
      <p className="mb-6 text-sm text-neutral-600">{t("intro")}</p>

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
          <p className="font-medium">
            {t(`status.${STATUS_KEY[latest.status]}`)}
          </p>
          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-neutral-600">{t("fields.document")}</dt>
            <dd>{t(`docType.${DOCTYPE_KEY[latest.document_type]}`)}</dd>
            <dt className="text-neutral-600">{t("fields.submittedOn")}</dt>
            <dd>{formatDate(latest.submitted_at, intlLocale)}</dd>
            {latest.reviewed_at ? (
              <>
                <dt className="text-neutral-600">{t("fields.decisionOn")}</dt>
                <dd>{formatDate(latest.reviewed_at, intlLocale)}</dd>
              </>
            ) : null}
            {latest.reviewer_note ? (
              <>
                <dt className="text-neutral-600">{t("fields.reason")}</dt>
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
                {t("previewLink")}
              </a>
            </p>
          ) : null}
        </section>
      ) : null}

      {latest?.status === "APPROVED" ? (
        role === "FARMER" ? (
          // FarMarket lives inside this Next app — internal route.
          <Link
            href="/farmarket/new"
            className="inline-block rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            {t("publishAd")}
          </Link>
        ) : (
          // SecondServe is a separate app (other origin) — external link with
          // session handoff, new tab to keep the VitaChain session.
          <SecondServeLink
            path="/restaurant-dashboard"
            className="inline-block rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            {t("publishSurplusBox")}
          </SecondServeLink>
        )
      ) : (
        <UploadForm />
      )}
    </main>
  );
}
