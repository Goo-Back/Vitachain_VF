import Link from "next/link";

import { AuthShell } from "../auth-shell";
import { ArrowRightIcon } from "../dashboard/farmer/_ui/Icon";
import { loginAction } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const next = sp.next ?? "/dashboard";

  return (
    <AuthShell title="Bon retour." subtitle="Connectez-vous à votre exploitation.">
      {sp.error ? (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-danger-500/30 bg-danger-50 p-3 text-sm text-danger-700"
        >
          {decodeURIComponent(sp.error)}
        </div>
      ) : null}

      <form action={loginAction} className="flex flex-col gap-4">
        <Field id="email" label="Email" type="email" autoComplete="email" required />
        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-xs font-medium text-neutral-600">
              Mot de passe
            </label>
            <a href="#" className="text-xs text-leaf-700 hover:underline">
              Oublié ?
            </a>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="vc-input mt-1"
          />
        </div>

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

        <button type="submit" className="vc-btn-primary mt-2 w-full">
          Se connecter
          <ArrowRightIcon size={14} />
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
          Créer mon exploitation
        </Link>
      </p>
    </AuthShell>
  );
}

function Field({
  id,
  label,
  type,
  autoComplete,
  required,
}: {
  id: string;
  label: string;
  type: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-neutral-600">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        required={required}
        className="vc-input mt-1"
      />
    </div>
  );
}
