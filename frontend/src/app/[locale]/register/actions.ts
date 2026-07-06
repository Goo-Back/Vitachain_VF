"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import * as Sentry from "@sentry/nextjs";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mapAuthError } from "@/lib/auth/errors";
import { hashEmail } from "@/lib/auth/email-hash";
import { RegisterSchema } from "./schema";

export async function registerAction(formData: FormData) {
  const requestLocale = await getLocale();
  const parsed = RegisterSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const key =
      firstIssue?.message === "weak_password" ? "weak_password" : "invalid_input";
    return redirect({ href: `/register?error=${key}`, locale: requestLocale });
  }

  const { full_name, email, password, role, locale } = parsed.data;

  // AUTH-02 — defensive recheck. Unreachable via the schema (ADMIN is not in
  // SELF_SIGNUP_ROLES), but catches a hand-crafted POST that bypasses zod.
  if ((role as string) === "ADMIN") {
    Sentry.captureMessage("AUTH-02: ADMIN role submitted to /register", {
      level: "warning",
      tags: { story: "AUTH-02", attack: "admin_escalation" },
    });
    return redirect({ href: "/register?error=invalid_input", locale: requestLocale });
  }

  const supabase = await createSupabaseServerClient();

  Sentry.addBreadcrumb({
    category: "auth",
    message: "signup_attempt",
    data: { email_hash: await hashEmail(email) },
    level: "info",
  });

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name, role, locale } },
  });

  if (error) {
    const key = mapAuthError(error);
    if (key === "unknown") {
      Sentry.captureException(error, {
        tags: { story: "AUTH-01", auth_error_code: error.code ?? "missing" },
      });
    }
    return redirect({ href: `/register?error=${key}`, locale: requestLocale });
  }

  // enable_confirmations = false in MVD → signUp returns a session immediately.
  // The runbook switch-back path flips this redirect to `/register/check-email`.
  revalidatePath("/", "layout");
  return redirect({ href: "/dashboard", locale: requestLocale });
}
