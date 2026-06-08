"use client";

import {
  Check,
  Eye,
  EyeOff,
  Globe,
  Lock,
  Mail,
  User,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

/**
 * Shared auth form controls used by /login and /register.
 *
 * Inputs carry a leading icon and a focus glow consistent with the
 * landing page. The password field adds a show/hide toggle and an
 * optional live strength checklist (register only). Every control keeps
 * the same `name` attribute the server actions already expect, so the
 * FormData contract is unchanged.
 *
 * Icons are referenced by a string key rather than passed as a prop:
 * lucide components are forwardRef objects and cannot cross the
 * Server → Client Component boundary as serialized props.
 */

export type AuthIcon = "mail" | "lock" | "user" | "globe";

const ICONS: Record<AuthIcon, LucideIcon> = {
  mail: Mail,
  lock: Lock,
  user: User,
  globe: Globe,
};

/* ------------------------------------------------------------------ */
/* TextField — labelled input with a leading icon.                     */
/* ------------------------------------------------------------------ */

export function TextField({
  id,
  name,
  label,
  icon,
  type = "text",
  autoComplete,
  required,
  placeholder,
  defaultValue,
  minLength,
  maxLength,
}: {
  id: string;
  name?: string;
  label: string;
  icon: AuthIcon;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  minLength?: number;
  maxLength?: number;
}) {
  const Icon = ICONS[icon];
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-neutral-600">
        {label}
      </label>
      <div className="group relative">
        <Icon
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 transition-colors group-focus-within:text-leaf-600"
        />
        <input
          id={id}
          name={name ?? id}
          type={type}
          autoComplete={autoComplete}
          required={required}
          placeholder={placeholder}
          defaultValue={defaultValue}
          minLength={minLength}
          maxLength={maxLength}
          className="vc-input pl-9"
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PasswordField — leading lock icon, show/hide toggle, optional meter. */
/* ------------------------------------------------------------------ */

const RULES = [
  { test: (v: string) => v.length >= 10 && v.length <= 72, label: "≥ 10 caractères" },
  { test: (v: string) => /[a-z]/.test(v), label: "une minuscule" },
  { test: (v: string) => /[A-Z]/.test(v), label: "une majuscule" },
  { test: (v: string) => /\d/.test(v), label: "un chiffre" },
];

export function PasswordField({
  id,
  name,
  label,
  icon = "lock",
  autoComplete = "current-password",
  placeholder = "••••••••",
  forgotHref,
  forgotLabel = "Oublié ?",
  strength = false,
  minLength,
  maxLength,
}: {
  id: string;
  name?: string;
  label: string;
  icon?: AuthIcon;
  autoComplete?: string;
  placeholder?: string;
  forgotHref?: string;
  forgotLabel?: string;
  strength?: boolean;
  minLength?: number;
  maxLength?: number;
}) {
  const Icon = ICONS[icon];
  const [visible, setVisible] = useState(false);
  const [value, setValue] = useState("");

  const passed = strength ? RULES.filter((r) => r.test(value)).length : 0;
  const barTone =
    passed <= 1 ? "bg-danger-500" : passed <= 3 ? "bg-warn-500" : "bg-leaf-500";

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor={id} className="text-xs font-medium text-neutral-600">
          {label}
        </label>
        {forgotHref ? (
          <a href={forgotHref} className="text-xs font-medium text-leaf-700 hover:underline">
            {forgotLabel}
          </a>
        ) : null}
      </div>

      <div className="group relative">
        <Icon
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 transition-colors group-focus-within:text-leaf-600"
        />
        <input
          id={id}
          name={name ?? id}
          type={visible ? "text" : "password"}
          required
          autoComplete={autoComplete}
          placeholder={placeholder}
          minLength={minLength}
          maxLength={maxLength}
          onChange={strength ? (e) => setValue(e.target.value) : undefined}
          className="vc-input px-9"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-neutral-400 transition-colors hover:text-neutral-700"
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>

      {strength ? (
        <div className="mt-2">
          <div className="flex gap-1" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i < passed ? barTone : "bg-neutral-200"
                }`}
              />
            ))}
          </div>
          <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
            {RULES.map((r) => {
              const ok = r.test(value);
              return (
                <li
                  key={r.label}
                  className={`flex items-center gap-1.5 text-xs transition-colors ${
                    ok ? "text-leaf-700" : "text-neutral-400"
                  }`}
                >
                  <Check
                    size={12}
                    className={ok ? "text-leaf-600" : "text-neutral-300"}
                    strokeWidth={3}
                  />
                  {r.label}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
