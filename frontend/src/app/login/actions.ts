"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(72),
  // Open-redirect guard: only allow same-origin relative paths.
  next: z
    .string()
    .startsWith("/")
    .refine((v) => !v.startsWith("//"), "invalid_next")
    .default("/dashboard"),
});

export async function loginAction(formData: FormData) {
  const parsed = LoginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    redirect("/login?error=invalid_input");
  }
  const { email, password, next } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Supabase returns "Invalid login credentials" — keep it as-is, it's UI-safe.
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  // Bust the Router Cache so no stale RSC payload from a previous account leaks
  // into the newly authenticated user's session.
  revalidatePath("/", "layout");
  redirect(next);
}
