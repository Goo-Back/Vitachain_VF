"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";

import { toIntlLocale } from "@/lib/intlLocale";

import {
  setUserBan,
  setUserRole,
  type AdminUser,
  type AdminUserRole,
} from "./actions";

const initState = { error: null };

const ROLES: AdminUserRole[] = ["FARMER", "RESTAURANT", "CITIZEN", "ADMIN"];

function formatDate(iso: string, locale: string) {
  try {
    return new Date(iso).toLocaleDateString(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function UserRow({
  user,
  isSelf,
}: {
  user: AdminUser;
  isSelf: boolean;
}) {
  const t = useTranslations("admin.users.row");
  const intlLocale = toIntlLocale(useLocale());
  const [roleState, roleAction, rolePending] = useActionState(
    setUserRole,
    initState,
  );
  const [banState, banAction, banPending] = useActionState(
    setUserBan,
    initState,
  );

  const error = roleState.error ?? banState.error;

  const VERIF_LABELS: Record<string, string> = {
    VERIFIED: t("verif.VERIFIED"),
    PENDING: t("verif.PENDING"),
    UNVERIFIED: t("verif.UNVERIFIED"),
    REJECTED: t("verif.REJECTED"),
  };

  return (
    <tr className="border-t border-neutral-100 align-middle">
      <td className="px-3 py-3">
        <p className="text-sm font-medium text-neutral-900">
          {user.full_name ?? "—"}
          {isSelf ? (
            <span className="ms-2 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500">
              {t("you")}
            </span>
          ) : null}
        </p>
        <p className="text-xs text-neutral-500">{user.email}</p>
        {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
      </td>

      <td className="px-3 py-3">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
            user.verification_status === "VERIFIED"
              ? "bg-emerald-100 text-emerald-700"
              : "bg-neutral-100 text-neutral-600"
          }`}
        >
          {VERIF_LABELS[user.verification_status] ?? user.verification_status}
        </span>
      </td>

      <td className="px-3 py-3">
        <form action={roleAction} className="flex items-center gap-1.5">
          <input type="hidden" name="user_id" value={user.id} />
          <select
            name="role"
            defaultValue={user.role}
            disabled={isSelf || rolePending}
            className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={isSelf || rolePending}
            className="rounded border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
          >
            {rolePending ? t("confirmPending") : t("confirm")}
          </button>
        </form>
      </td>

      <td className="px-3 py-3 text-xs text-neutral-500">
        {formatDate(user.created_at, intlLocale)}
      </td>

      <td className="px-3 py-3">
        {user.banned ? (
          <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            {t("banned")}
          </span>
        ) : (
          <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            {t("active")}
          </span>
        )}
      </td>

      <td className="px-3 py-3 text-right">
        <form action={banAction}>
          <input type="hidden" name="user_id" value={user.id} />
          <input
            type="hidden"
            name="banned"
            value={user.banned ? "false" : "true"}
          />
          <button
            type="submit"
            disabled={isSelf || banPending}
            className={`rounded px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
              user.banned
                ? "border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                : "border border-red-300 text-red-700 hover:bg-red-50"
            }`}
          >
            {banPending
              ? t("banPending")
              : user.banned
                ? t("reactivate")
                : t("ban")}
          </button>
        </form>
      </td>
    </tr>
  );
}
