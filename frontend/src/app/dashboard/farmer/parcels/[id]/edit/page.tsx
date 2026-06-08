import { notFound, redirect } from "next/navigation";

import { getServerProfile } from "@/lib/auth/session";

import { PageHeader } from "@/app/dashboard/farmer/_ui/PageHeader";

import { fetchParcel } from "../../actions";
import { EditParcelForm } from "./edit-parcel-form";

export const dynamic = "force-dynamic";

export default async function EditParcelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const profile = await getServerProfile();

  if (profile?.role !== "FARMER") redirect("/dashboard");
  if (profile.verification_status !== "VERIFIED") redirect(`/dashboard/farmer/parcels/${id}`);

  const parcel = await fetchParcel(id);
  if (!parcel) notFound();

  return (
    <div className="mx-auto max-w-2xl vc-fade-in">
      <PageHeader
        crumbs={[
          { label: "Mon exploitation", href: "/dashboard/farmer" },
          { label: "Mes parcelles", href: "/dashboard/farmer/parcels" },
          { label: parcel.name, href: `/dashboard/farmer/parcels/${id}` },
          { label: "Modifier" },
        ]}
        eyebrow="Parcelle"
        title={`Modifier "${parcel.name}"`}
      />
      <div className="vc-card p-6">
        <EditParcelForm parcel={parcel} />
      </div>
    </div>
  );
}
