"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { MOROCCO_REGIONS } from "@/app/[locale]/dashboard/farmer/ads/new/regions";
import { AlertIcon, CheckCircleIcon } from "@/app/[locale]/dashboard/farmer/_ui/Icon";

import { updateFarmerProfile, type ProfileFormState } from "./actions";

const INITIAL: ProfileFormState = { error: null, ok: false };

/**
 * FAR-11 — editable farmer public profile (prénom, nom, région). These fields
 * are shown to restaurants on the marketplace offer + producer pages.
 */
export function ProfileForm({
  firstName,
  lastName,
  region,
}: {
  firstName: string;
  lastName: string;
  region: string;
}) {
  const t = useTranslations("farmer.settings.profileForm");
  const [state, formAction, pending] = useActionState(updateFarmerProfile, INITIAL);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor="first_name" className="block text-xs font-medium text-neutral-600">
          {t("firstName")}
        </label>
        <input
          id="first_name"
          name="first_name"
          defaultValue={firstName}
          maxLength={80}
          className="vc-input mt-1"
        />
      </div>

      <div>
        <label htmlFor="last_name" className="block text-xs font-medium text-neutral-600">
          {t("lastName")}
        </label>
        <input
          id="last_name"
          name="last_name"
          defaultValue={lastName}
          maxLength={80}
          className="vc-input mt-1"
        />
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="farmer_region" className="block text-xs font-medium text-neutral-600">
          {t("region")}
        </label>
        <select
          id="farmer_region"
          name="farmer_region"
          defaultValue={region}
          className="vc-input mt-1"
        >
          <option value="">{t("regionNotSet")}</option>
          {MOROCCO_REGIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-neutral-400">
          {t("regionHelp")}
        </p>
      </div>

      <div className="sm:col-span-2 flex items-center justify-end gap-3">
        {state.error && (
          <span className="inline-flex items-center gap-1.5 text-xs text-danger-700">
            <AlertIcon size={14} /> {state.error}
          </span>
        )}
        {state.ok && (
          <span className="inline-flex items-center gap-1.5 text-xs text-leaf-700">
            <CheckCircleIcon size={14} /> {t("saved")}
          </span>
        )}
        <button type="submit" disabled={pending} className="vc-btn-primary disabled:opacity-60">
          {pending ? t("saving") : t("save")}
        </button>
      </div>
    </form>
  );
}
