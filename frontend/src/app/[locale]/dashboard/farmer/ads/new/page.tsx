import { getLocale, getTranslations } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";

import { getServerProfile } from "@/lib/auth/session";

import { NewAdForm } from "./new-ad-form";

export const dynamic = "force-dynamic";

export default async function NewAdPage() {
  const locale = await getLocale();
  const t = await getTranslations("farmer.ads.new");
  const profile = await getServerProfile();
  if (profile?.role !== "FARMER") return redirect({ href: "/dashboard", locale });
  if (profile.verification_status !== "VERIFIED") {
    return redirect({ href: "/onboarding/verification", locale });
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <Link
          href="/dashboard/farmer/ads"
          className="text-sm text-neutral-500 hover:text-leaf-700"
        >
          {t("backToAds")}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-900">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          {t("subtitle")}
        </p>
      </div>

      <div className="vc-card p-6">
        <NewAdForm />
      </div>
    </main>
  );
}
