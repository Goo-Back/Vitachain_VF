import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileRow } from "@/lib/supabase/types";

import { PageHeader } from "../../../_ui/PageHeader";
import { fetchAdById } from "../../actions";
import { EditAdForm } from "./edit-ad-form";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditAdPage({ params }: Props) {
  const { id } = await params;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, verification_status")
    .eq("id", user.id)
    .single<Pick<ProfileRow, "role" | "verification_status">>();

  if (profile?.role !== "FARMER" || profile.verification_status !== "VERIFIED") {
    redirect("/dashboard/farmer/ads");
  }

  const ad = await fetchAdById(id);
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
