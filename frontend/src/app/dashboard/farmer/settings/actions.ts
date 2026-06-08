"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MOROCCO_REGIONS } from "@/app/dashboard/farmer/ads/new/regions";

export type ProfileFormState = { error: string | null; ok: boolean };

/**
 * FAR-11 — farmer edits their public profile (prénom, nom, région).
 *
 * Writes directly to public.profiles via the user-scoped Supabase client.
 * The `profiles_update_own` RLS policy (migration 0002) permits self-edits of
 * these columns; role / verification_status stay locked at the DB layer.
 * full_name is kept in sync so legacy reads keep working.
 */
export async function updateFarmerProfile(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const supabase = await createSupabaseServerClient();
  // Middleware already revalidated the token on this POST — read the session
  // (local, no network) rather than a redundant getUser() round-trip.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;
  if (!user) return { error: "Session expirée. Reconnectez-vous.", ok: false };

  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const region = String(formData.get("farmer_region") ?? "").trim();

  if (firstName.length > 80 || lastName.length > 80) {
    return { error: "Le nom et le prénom doivent faire moins de 80 caractères.", ok: false };
  }
  if (region && !MOROCCO_REGIONS.includes(region as (typeof MOROCCO_REGIONS)[number])) {
    return { error: "Région invalide.", ok: false };
  }

  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

  const { error } = await supabase
    .from("profiles")
    .update({
      first_name: firstName || null,
      last_name: lastName || null,
      farmer_region: region || null,
      ...(fullName ? { full_name: fullName } : {}),
    })
    .eq("id", user.id);

  if (error) return { error: "L'enregistrement a échoué. Réessayez.", ok: false };

  revalidatePath("/dashboard/farmer/settings");
  return { error: null, ok: true };
}
