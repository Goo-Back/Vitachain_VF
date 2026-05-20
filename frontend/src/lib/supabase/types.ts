// Hand-typed mirror of the columns the frontend reads from public.profiles
// (migration 0002 — INF-02). Kept here, not in @/types, so adding a domain
// table later doesn't require pulling in the full generated DB types.
//
// When INF-04 wires `supabase gen types`, this file is replaced by the
// generated Database type and imported via createSupabaseServerClient<Database>.

export type UserRole = "FARMER" | "RESTAURANT" | "CITIZEN" | "ADMIN";
export type VerificationStatus = "PENDING" | "VERIFIED" | "REJECTED";
export type LocaleCode = "fr" | "ar" | "en";

export interface ProfileRow {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: UserRole;
  verification_status: VerificationStatus;
  locale: LocaleCode;
  created_at: string;
  updated_at: string;
}
