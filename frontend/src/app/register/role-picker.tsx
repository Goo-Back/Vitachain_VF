"use client";

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
export default function RolePicker({
  name = "role",
  defaultRole = "CITIZEN" as SelfSignupRole,
}: {
  name?: string;
  defaultRole?: SelfSignupRole;
}) {
  const [selected, setSelected] = useState<SelfSignupRole>(defaultRole);

  return (
    <fieldset className="mt-1 flex flex-col gap-2">
      <legend className="sr-only">Rôle</legend>
      {SELF_SIGNUP_ROLES.map((r) => {
        const meta = ROLE_DESCRIPTIONS_FR[r];
        const isSelected = selected === r;
        return (
          <label
            key={r}
            className={
              "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition " +
              (isSelected
                ? "border-leaf-500 bg-leaf-50 ring-1 ring-leaf-200"
                : "border-neutral-200 hover:border-leaf-300")
            }
          >
            <input
              type="radio"
              name={name}
              value={r}
              checked={isSelected}
              onChange={() => setSelected(r)}
              className="mt-1 text-leaf-600 focus:ring-leaf-500"
              required
            />
            <span>
              <span className="block font-medium text-neutral-900">
                {meta.label}
              </span>
              <span className="block text-xs text-neutral-600">
                {meta.blurb}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
