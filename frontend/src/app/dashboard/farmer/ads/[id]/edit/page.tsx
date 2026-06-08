import { redirect } from "next/navigation";

import { getServerProfile } from "@/lib/auth/session";

import { PageHeader } from "../../../_ui/PageHeader";
import { fetchAdById } from "../../actions";
import { EditAdForm } from "./edit-ad-form";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditAdPage({ params }: Props) {
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
    redirect("/dashboard/farmer/ads");
  }

  if (!ad) redirect("/dashboard/farmer/ads");
  if (ad.status !== "ACTIVE") redirect("/dashboard/farmer/ads");

  return (
    <div className="mx-auto max-w-2xl vc-fade-in">
      <PageHeader
        crumbs={[
          { label: "Mon exploitation", href: "/dashboard/farmer" },
          { label: "Mes annonces", href: "/dashboard/farmer/ads" },
          { label: "Modifier" },
        ]}
        eyebrow="FarMarket"
        title="Modifier l'annonce"
        subtitle={ad.title}
      />
      <EditAdForm ad={ad} />
    </div>
  );
}
