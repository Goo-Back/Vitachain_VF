import Link from "next/link";
import { AlertCircle, ArrowRight, Globe } from "lucide-react";

import { AuthShell } from "../auth-shell";
import { PasswordField, TextField } from "../_auth/fields";
import { registerAction } from "./actions";
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
      title="Bienvenue dans VitaChain."
      subtitle="Choisissez votre rôle et accédez à toute la chaîne — du suivi des cultures à la lutte contre le gaspillage."
      badge="Créer un compte"
    >
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
          label="Nom complet"
          icon="user"
          autoComplete="name"
          placeholder="Karim Benali"
          required
          minLength={2}
          maxLength={120}
        />

        <TextField
          id="email"
          label="Email"
          type="email"
          icon="mail"
          autoComplete="email"
          placeholder="vous@exemple.com"
          required
        />

        <PasswordField
          id="password"
          label="Mot de passe"
          icon="lock"
          autoComplete="new-password"
          placeholder="Au moins 10 caractères"
          strength
          minLength={10}
          maxLength={72}
        />

        <div>
          <p className="mb-1.5 text-xs font-medium text-neutral-600">Je suis…</p>
          <RolePicker name="role" defaultRole="CITIZEN" />
        </div>

        <div>
          <label htmlFor="locale" className="mb-1.5 block text-xs font-medium text-neutral-600">
            Langue
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
            J&apos;accepte les{" "}
            <a href="#" className="text-leaf-700 underline">
              conditions d&apos;utilisation
            </a>{" "}
            et la politique de confidentialité.
          </span>
        </label>

        <button type="submit" className="vc-btn-primary mt-2 w-full py-2.5">
          Créer mon compte
          <ArrowRight size={15} />
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
