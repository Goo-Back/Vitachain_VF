import Link from "next/link";
import { AlertCircle, ArrowRight } from "lucide-react";

import { AuthShell } from "../auth-shell";
import { PasswordField, TextField } from "../_auth/fields";
import { loginAction } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const next = sp.next ?? "/dashboard";

  return (
    <AuthShell
      title="Bon retour."
      subtitle="Connectez-vous pour reprendre la main sur votre filière."
      badge="Connexion"
    >
      {sp.error ? (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2 rounded-xl border border-danger-500/30 bg-danger-50 p-3 text-sm text-danger-700"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{decodeURIComponent(sp.error)}</span>
        </div>
      ) : null}

      <form action={loginAction} className="flex flex-col gap-4">
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
          autoComplete="current-password"
          forgotHref="#"
        />

        <label className="flex items-center gap-2 text-xs text-neutral-600">
          <input
            type="checkbox"
            name="remember"
            defaultChecked
            className="h-4 w-4 rounded border-neutral-300 text-leaf-600 focus:ring-leaf-500"
          />
          Rester connecté sur cet appareil
        </label>

        <input type="hidden" name="next" value={next} />

        <button type="submit" className="vc-btn-primary mt-2 w-full py-2.5">
          Se connecter
          <ArrowRight size={15} />
        </button>
      </form>

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-neutral-200" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-white px-3 text-xs uppercase tracking-wide text-neutral-400">
            ou
          </span>
        </div>
      </div>

      <p className="text-center text-sm text-neutral-600">
        Pas encore de compte ?{" "}
        <Link href="/register" className="font-medium text-leaf-700 hover:underline">
          Créer mon compte
        </Link>
      </p>
    </AuthShell>
  );
}
