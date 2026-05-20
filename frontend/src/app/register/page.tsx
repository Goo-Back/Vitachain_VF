import Link from "next/link";

import { AuthShell } from "../auth-shell";
import { ArrowRightIcon } from "../dashboard/farmer/_ui/Icon";
import { registerAction } from "./actions";
import PasswordHint from "./password-hint";
import RolePicker from "./role-picker";
import type { AuthErrorKey } from "@/lib/auth/errors";

// TODO(i18n) — moved to register.json in I18N-02.
const FR_ERRORS: Record<AuthErrorKey, string> = {
  email_taken: "Un compte existe déjà avec cet email.",
  weak_password:
    "Mot de passe trop faible — au moins 10 caractères, avec majuscule, minuscule et chiffre.",
  rate_limited: "Trop de tentatives. Veuillez réessayer dans une heure.",
  invalid_input: "Données invalides — vérifiez les champs.",
  network: "Connexion impossible. Vérifiez votre réseau et réessayez.",
  unknown: "Une erreur inattendue est survenue. Notre équipe a été notifiée.",
};

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
  const errorKey =
    sp.error && ALLOWED_ERROR_KEYS.has(sp.error as AuthErrorKey)
      ? (sp.error as AuthErrorKey)
      : sp.error
        ? "unknown"
        : null;
  const errorMessage = errorKey ? FR_ERRORS[errorKey] : null;

  return (
    <AuthShell
      title="Bienvenue dans Katara."
      subtitle="Quelques informations et vous serez prêt à connecter votre première parcelle."
    >
      {errorMessage ? (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-danger-500/30 bg-danger-50 p-3 text-sm text-danger-700"
        >
          {errorMessage}
        </div>
      ) : null}

      <form action={registerAction} className="flex flex-col gap-4">
        <div>
          <label htmlFor="full_name" className="text-xs font-medium text-neutral-600">
            Nom complet
          </label>
          <input
            id="full_name"
            name="full_name"
            type="text"
            required
            minLength={2}
            maxLength={120}
            autoComplete="name"
            className="vc-input mt-1"
          />
        </div>

        <div>
          <label htmlFor="email" className="text-xs font-medium text-neutral-600">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="vc-input mt-1"
          />
        </div>

        <div>
          <label htmlFor="password" className="text-xs font-medium text-neutral-600">
            Mot de passe
          </label>
          <PasswordHint name="password" />
        </div>

        <div>
          <p className="text-xs font-medium text-neutral-600">Rôle</p>
          <RolePicker name="role" defaultRole="CITIZEN" />
        </div>

        <div>
          <label htmlFor="locale" className="text-xs font-medium text-neutral-600">
            Langue
          </label>
          <select
            id="locale"
            name="locale"
            defaultValue="fr"
            className="vc-input mt-1"
          >
            <option value="fr">Français</option>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </div>

        <label className="flex items-start gap-2 text-xs text-neutral-600">
          <input
            type="checkbox"
            required
            className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-leaf-600 focus:ring-leaf-500"
          />
          <span>
            J&apos;accepte les{" "}
            <a href="#" className="text-leaf-700 underline">
              conditions d&apos;utilisation
            </a>{" "}
            et la politique de confidentialité.
          </span>
        </label>

        <button type="submit" className="vc-btn-primary mt-2 w-full">
          Créer mon compte
          <ArrowRightIcon size={14} />
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-neutral-600">
        Déjà inscrit ?{" "}
        <Link href="/login" className="font-medium text-leaf-700 hover:underline">
          Connexion
        </Link>
      </p>
    </AuthShell>
  );
}
