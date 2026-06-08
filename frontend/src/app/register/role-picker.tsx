"use client";

import { Check, Sprout, Store, User, type LucideIcon } from "lucide-react";
import { useState } from "react";

import {
  ROLE_DESCRIPTIONS_FR,
  SELF_SIGNUP_ROLES,
  type SelfSignupRole,
} from "@/lib/auth/roles";

/**
 * AUTH-02 — Three-radio role picker. Replaces the AUTH-01 <select> so the
 * consequence of each role (KYC required vs. open access) is legible at
 * signup time. The server still receives `role=…` in the same FormData key.
 */

const ROLE_ICONS: Record<SelfSignupRole, LucideIcon> = {
  FARMER: Sprout,
  RESTAURANT: Store,
  CITIZEN: User,
};

export default function RolePicker({
  name = "role",
  defaultRole = "CITIZEN" as SelfSignupRole,
}: {
  name?: string;
  defaultRole?: SelfSignupRole;
}) {
  const [selected, setSelected] = useState<SelfSignupRole>(defaultRole);

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">Rôle</legend>
      {SELF_SIGNUP_ROLES.map((r) => {
        const meta = ROLE_DESCRIPTIONS_FR[r];
        const Icon = ROLE_ICONS[r];
        const isSelected = selected === r;
        return (
          <label
            key={r}
            className={
              "group relative flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition " +
              (isSelected
                ? "border-leaf-500 bg-leaf-50 ring-1 ring-leaf-200"
                : "border-neutral-200 hover:border-leaf-300 hover:bg-leaf-50/40")
            }
          >
            <input
              type="radio"
              name={name}
              value={r}
              checked={isSelected}
              onChange={() => setSelected(r)}
              className="sr-only"
              required
            />
            <span
              className={
                "grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors " +
                (isSelected
                  ? "bg-leaf-600 text-white"
                  : "bg-neutral-100 text-neutral-500 group-hover:bg-leaf-100 group-hover:text-leaf-700")
              }
            >
              <Icon size={18} />
            </span>
            <span className="min-w-0">
              <span className="block font-medium text-neutral-900">
                {meta.label}
              </span>
              <span className="block text-xs leading-snug text-neutral-600">
                {meta.blurb}
              </span>
            </span>
            <span
              className={
                "ml-auto mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border transition " +
                (isSelected
                  ? "border-leaf-600 bg-leaf-600 text-white"
                  : "border-neutral-300 text-transparent")
              }
              aria-hidden
            >
              <Check size={12} strokeWidth={3} />
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
