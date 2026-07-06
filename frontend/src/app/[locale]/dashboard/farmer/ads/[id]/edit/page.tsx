import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";

import { getServerProfile } from "@/lib/auth/session";

import { PageHeader } from "../../../_ui/PageHeader";
import { fetchAdById } from "../../actions";
import { EditAdForm } from "./edit-ad-form";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditAdPage({ params }: Props) {
  const locale = await getLocale();
  const t = await getTranslations("farmer.ads.edit");
  const tCommon = await getTranslations("farmer.common");
  const tAdsList = await getTranslations("farmer.ads.list");
  const { id } = await params;

  // Profile gate + ad load are independent — run them in parallel so the form
  // paints after one round-trip instead of two sequential ones. The backend
  // RLS still scopes the ad to its owner, so loading it before the role check
  // is safe.
  const [profile, ad] = await Promise.all([
    getServerProfile(),
    fetchAdById(id),
  ]);

  if (profile?.role !== "FARMER" || profile.verification_status !== "VERIFIED") {
    return redirect({ href: "/dashboard/farmer/ads", locale });
  }

  if (!ad) return redirect({ href: "/dashboard/farmer/ads", locale });
  if (ad.status !== "ACTIVE") return redirect({ href: "/dashboard/farmer/ads", locale });

  return (
    <div className="mx-auto max-w-2xl vc-fade-in">
      <PageHeader
        crumbs={[
          { label: tCommon("breadcrumbHome"), href: "/dashboard/farmer" },
          { label: tAdsList("breadcrumb"), href: "/dashboard/farmer/ads" },
          { label: t("breadcrumbEdit") },
        ]}
        eyebrow={t("eyebrow")}
        title={t("title")}
        subtitle={ad.title}
      />
      <EditAdForm ad={ad} />
    </div>
  );
}
