import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";

import { getServerProfile } from "@/lib/auth/session";

import { PageHeader } from "@/app/[locale]/dashboard/farmer/_ui/PageHeader";

import { fetchParcel } from "../../actions";
import { EditParcelForm } from "./edit-parcel-form";

export const dynamic = "force-dynamic";

export default async function EditParcelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const locale = await getLocale();
  const t = await getTranslations("farmer.parcels.edit");
  const tCommon = await getTranslations("farmer.common");
  const tParcelsCommon = await getTranslations("farmer.parcels.common");
  const { id } = await params;

  const profile = await getServerProfile();

  if (profile?.role !== "FARMER") return redirect({ href: "/dashboard", locale });
  if (profile.verification_status !== "VERIFIED") {
    return redirect({ href: `/dashboard/farmer/parcels/${id}`, locale });
  }

  const parcel = await fetchParcel(id);
  if (!parcel) notFound();

  return (
    <div className="mx-auto max-w-2xl vc-fade-in">
      <PageHeader
        crumbs={[
          { label: tCommon("breadcrumbHome"), href: "/dashboard/farmer" },
          { label: tParcelsCommon("breadcrumb"), href: "/dashboard/farmer/parcels" },
          { label: parcel.name, href: `/dashboard/farmer/parcels/${id}` },
          { label: t("breadcrumbModify") },
        ]}
        eyebrow={t("eyebrow")}
        title={t("modifyTitle", { name: parcel.name })}
      />
      <div className="vc-card p-6">
        <EditParcelForm parcel={parcel} />
      </div>
    </div>
  );
}
