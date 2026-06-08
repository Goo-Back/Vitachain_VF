import { getServerProfile } from "@/lib/auth/session";

import { fetchUsers, type AdminUserPage } from "./actions";
import { UserRow } from "./UserRow";

export const dynamic = "force-dynamic";

const ROLE_OPTIONS = [
  { value: "", label: "Tous les rôles" },
  { value: "FARMER", label: "Agriculteur" },
  { value: "RESTAURANT", label: "Restaurant" },
  { value: "CITIZEN", label: "Citoyen" },
  { value: "ADMIN", label: "Admin" },
];

const STATUS_OPTIONS = [
  { value: "", label: "Tous les statuts" },
  { value: "active", label: "Actifs" },
  { value: "banned", label: "Bannis" },
];

type SearchParams = {
  q?: string;
  role?: string;
  status?: string;
  page?: string;
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  const pageSize = 20;

  const profile = await getServerProfile();
  const selfId = profile?.id ?? null;

  let data: AdminUserPage = {
    users: [],
    total: 0,
    page,
    page_size: pageSize,
  };
  let fetchError: string | null = null;
  try {
    data = await fetchUsers({
      q: sp.q,
      role: sp.role,
      status: sp.status,
      page,
      pageSize,
    });
  } catch (e) {
    fetchError = e instanceof Error ? e.message : "Erreur inconnue";
  }

  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));

  function pageHref(target: number) {
    const params = new URLSearchParams();
    if (sp.q) params.set("q", sp.q);
    if (sp.role) params.set("role", sp.role);
    if (sp.status) params.set("status", sp.status);
    params.set("page", String(target));
    return `/dashboard/admin/users?${params.toString()}`;
  }

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">
            Utilisateurs
          </h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            Gérer les comptes, rôles et accès de la plateforme.
          </p>
        </div>
        <span className="rounded-full bg-blue-100 px-3 py-0.5 text-xs font-medium text-blue-800">
          {data.total} compte{data.total > 1 ? "s" : ""}
        </span>
      </div>

      <form
        method="get"
        className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-4"
      >
        <div className="flex-1 min-w-[200px]">
          <label className="mb-1 block text-xs text-neutral-500">
            Recherche
          </label>
          <input
            type="search"
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Nom ou e-mail…"
            className="w-full rounded border border-neutral-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-neutral-500">Rôle</label>
          <select
            name="role"
            defaultValue={sp.role ?? ""}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-neutral-500">Statut</label>
          <select
            name="status"
            defaultValue={sp.status ?? ""}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Filtrer
        </button>
      </form>

      {fetchError ? (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Impossible de charger les utilisateurs : {fetchError}
        </div>
      ) : data.users.length === 0 ? (
        <div className="rounded border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
          Aucun utilisateur ne correspond à ces critères.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-neutral-400">
                <th className="px-3 py-2 font-medium">Utilisateur</th>
                <th className="px-3 py-2 font-medium">KYC</th>
                <th className="px-3 py-2 font-medium">Rôle</th>
                <th className="px-3 py-2 font-medium">Inscrit</th>
                <th className="px-3 py-2 font-medium">Statut</th>
                <th className="px-3 py-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  isSelf={user.id === selfId}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!fetchError && data.total > pageSize ? (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-neutral-500">
            Page {page + 1} / {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 0 ? (
              <a
                href={pageHref(page - 1)}
                className="rounded border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-100"
              >
                Précédent
              </a>
            ) : null}
            {page + 1 < totalPages ? (
              <a
                href={pageHref(page + 1)}
                className="rounded border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-100"
              >
                Suivant
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
