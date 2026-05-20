"use client";

import { useState } from "react";

/**
 * AUTH-01 — Live-update checklist below the password input. Purely cosmetic;
 * the real gate is Supabase Auth's server-side password policy (see
 * supabase/config.toml [auth.email.password]).
 */
export default function PasswordHint({ name = "password" }: { name?: string }) {
  const [v, setV] = useState("");

  // TODO(i18n) — moved to register.json in I18N-02
  const rules = [
    { ok: v.length >= 10 && v.length <= 72, label: "≥ 10 caractères" },
    { ok: /[a-z]/.test(v), label: "une minuscule" },
    { ok: /[A-Z]/.test(v), label: "une majuscule" },
    { ok: /\d/.test(v), label: "un chiffre" },
  ];

  return (
    <div className="flex flex-col gap-1">
      <input
        id={name}
        name={name}
        type="password"
        required
        minLength={10}
        maxLength={72}
        autoComplete="new-password"
        placeholder="Mot de passe"
        className="rounded border border-neutral-300 p-2 text-sm"
        onChange={(e) => setV(e.target.value)}
      />
      <ul className="mt-1 text-xs">
        {rules.map((r) => (
          <li
            key={r.label}
            className={r.ok ? "text-emerald-700" : "text-neutral-500"}
          >
            {r.ok ? "✓" : "·"} {r.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
