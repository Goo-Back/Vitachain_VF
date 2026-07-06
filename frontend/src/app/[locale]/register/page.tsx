import { Link } from "@/i18n/navigation";
import { AlertCircle, ArrowRight, Globe } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { AuthShell } from "../../auth-shell";
import { PasswordField, TextField } from "../../_auth/fields";
import { registerAction } from "./actions";
import RolePicker from "./role-picker";
import type { AuthErrorKey } from "@/lib/auth/errors";
import { SECONDSERVE_URL } from "@/lib/secondserve";

const ALLOWED_ERROR_KEYS = new Set<AuthErrorKey>([
  "email_taken",
  "weak_password",
  "rate_limited",
  "invalid_input",
  "network",
  "unknown",
]);

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  const t = await getTranslations("auth.register");
  const errorKey =
    sp.error && ALLOWED_ERROR_KEYS.has(sp.error as AuthErrorKey)
      ? (sp.error as AuthErrorKey)
      : sp.error
        ? "unknown"
        : null;
  const errorMessage = errorKey ? t(`errors.${errorKey}`) : null;

  return (
    <AuthShell title={t("title")} subtitle={t("subtitle")} badge={t("badge")}>
      {errorMessage ? (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2 rounded-xl border border-danger-500/30 bg-danger-50 p-3 text-sm text-danger-700"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      ) : null}

      <form action={registerAction} className="flex flex-col gap-4">
        <TextField
          id="full_name"
          label={t("fullNameLabel")}
          icon="user"
          autoComplete="name"
          placeholder="Karim Benali"
          required
          minLength={2}
          maxLength={120}
        />

        <TextField
          id="email"
          label={t("emailLabel")}
          type="email"
          icon="mail"
          autoComplete="email"
          placeholder="vous@exemple.com"
          required
        />

        <PasswordField
          id="password"
          label={t("passwordLabel")}
          icon="lock"
          autoComplete="new-password"
          placeholder="Au moins 10 caractères"
          strength
          minLength={10}
          maxLength={72}
        />

        <div>
          <p className="mb-1.5 text-xs font-medium text-neutral-600">{t("roleLabel")}</p>
          <RolePicker name="role" defaultRole="CITIZEN" />
        </div>

        <div>
          <label htmlFor="locale" className="mb-1.5 block text-xs font-medium text-neutral-600">
            {t("languageLabel")}
          </label>
          <div className="group relative">
            <Globe
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 transition-colors group-focus-within:text-leaf-600"
            />
            <select id="locale" name="locale" defaultValue="fr" className="vc-input pl-9">
              <option value="fr">Français</option>
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>

        <label className="flex items-start gap-2 text-xs text-neutral-600">
          <input
            type="checkbox"
            required
            className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-leaf-600 focus:ring-leaf-500"
          />
          <span>
            {t("termsPrefix")}{" "}
            <a href="#" className="text-leaf-700 underline">
              {t("termsLink")}
            </a>{" "}
            {t("termsSuffix")}
          </span>
        </label>

        <button type="submit" className="vc-btn-primary mt-2 w-full py-2.5">
          {t("submit")}
          <ArrowRight size={15} />
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-neutral-600">
        {t("alreadyRegistered")}{" "}
        <Link href="/login" className="font-medium text-leaf-700 hover:underline">
          {t("login")}
        </Link>
      </p>

      <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-center text-xs text-emerald-800">
        {t("secondserveCta")}{" "}
        <a
          href={`${SECONDSERVE_URL}/auth?tab=signup`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold underline hover:text-emerald-600"
        >
          {t("secondserveLink")}
        </a>
      </div>
    </AuthShell>
  );
}
