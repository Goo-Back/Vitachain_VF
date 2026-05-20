import { z } from "zod";

import { SELF_SIGNUP_ROLES } from "@/lib/auth/roles";

/**
 * AUTH-01 / AUTH-02 — Mirror of the enums validated by handle_new_user()
 * (db/migrations/0003 — INF-02). ADMIN is excluded via SELF_SIGNUP_ROLES; a
 * future PR cannot silently widen the set without touching roles.ts, which
 * is parity-checked against the Postgres enum in CI.
 *
 * Password floor matches `supabase/config.toml [auth.email.password]` — the
 * Supabase Auth setting is the real gate; this schema is the early-return
 * for an obviously-bad client submission.
 *
 * Lives in its own module so Vitest can import it (the actions.ts module is
 * marked "use server" and cannot export non-async values under Next 15).
 */
export const RegisterSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z
    .string()
    .min(10, "weak_password")
    .max(72, "weak_password")
    .regex(/[a-z]/, "weak_password")
    .regex(/[A-Z]/, "weak_password")
    .regex(/\d/, "weak_password"),
  role: z.enum(SELF_SIGNUP_ROLES),
  locale: z.enum(["fr", "ar", "en"]).default("fr"),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
