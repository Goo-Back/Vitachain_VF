/**
 * AUTH-02 — Single TS mirror of the public.user_role Postgres enum
 * (db/migrations/0001_extensions_and_enums.sql).
 *
 * SELF_SIGNUP_ROLES is the closed set the public /register form may emit.
 * ALL_ROLES adds ADMIN — used by admin-side code (ADM-01, AUTH-06) that
 * needs to render the full enum (e.g. a verification queue filter).
 *
 * Drift between this file and the Postgres enum is caught by
 * scripts/check-role-enum-parity.sh in CI.
 */
export const SELF_SIGNUP_ROLES = ["FARMER", "RESTAURANT", "CITIZEN"] as const;
export const ALL_ROLES = [
  "FARMER",
  "RESTAURANT",
  "CITIZEN",
  "ADMIN",
] as const;

export type SelfSignupRole = (typeof SELF_SIGNUP_ROLES)[number];
export type UserRole = (typeof ALL_ROLES)[number];

// TODO(i18n) — moved to register.json in I18N-02.
export const ROLE_DESCRIPTIONS_FR: Record<
  SelfSignupRole,
  { label: string; blurb: string }
> = {
  FARMER: {
    label: "Agriculteur",
    blurb:
      "Je cultive et souhaite vendre directement aux restaurateurs. Vérification requise.",
  },
  RESTAURANT: {
    label: "Restaurateur",
    blurb:
      "Je gère un restaurant et souhaite acheter des produits frais (FarMarket) ou publier des invendus (SecondServe). Vérification requise.",
  },
  CITIZEN: {
    label: "Citoyen",
    blurb:
      "Je cherche des paniers anti-gaspi près de chez moi. Vous serez redirigé vers SecondServe après l'inscription.",
  },
};
