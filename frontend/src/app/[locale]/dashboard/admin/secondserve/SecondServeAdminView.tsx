"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { toIntlLocale } from "@/lib/intlLocale";

import type { SsOrder, SsStats, SsTicket, SsUser } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Tab = "dashboard" | "partners" | "users" | "orders" | "support";

type Props = {
  accessToken: string;
  users: SsUser[];
  usersTotal: number;
  partners: SsUser[];
  orders: SsOrder[];
  ordersTotal: number;
  tickets: SsTicket[];
  stats: SsStats | null;
};

function fmtDate(iso: string, locale: string) {
  try {
    return new Date(iso).toLocaleString(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const ORDER_STATUS_CLS: Record<string, string> = {
  active: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
};

export function SecondServeAdminView({
  accessToken,
  users: initialUsers,
  usersTotal,
  partners: initialPartners,
  orders: initialOrders,
  ordersTotal,
  tickets: initialTickets,
  stats,
}: Props) {
  // Named `tt` (not `t`) because this file already uses `t` as the loop
  // variable name for support tickets throughout.
  const tt = useTranslations("admin.secondserve");
  const intlLocale = toIntlLocale(useLocale());
  const [tab, setTab] = useState<Tab>("dashboard");
  const [users, setUsers] = useState(initialUsers);
  const [partners, setPartners] = useState(initialPartners);
  const [orders, setOrders] = useState(initialOrders);
  const [tickets, setTickets] = useState(initialTickets);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, init: RequestInit, busyKey: string) {
    setBusy(busyKey);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1${path}`, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          Authorization: `Bearer ${accessToken}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
      });
      if (!res.ok) {
        setError(tt("errorStatus", { status: res.status }));
        return false;
      }
      return true;
    } catch {
      setError(tt("networkError"));
      return false;
    } finally {
      setBusy(null);
    }
  }

  // ---- Partner actions ----
  async function setApproval(id: string, approved: boolean) {
    const ok = await call(
      `/admin/secondserve/partners/${id}/approval`,
      { method: "PATCH", body: JSON.stringify({ approved }) },
      `partner:${id}`,
    );
    if (ok) {
      setPartners((prev) =>
        prev.map((p) => (p.id === id ? { ...p, approved } : p)),
      );
    }
  }

  // ---- User actions ----
  async function setBan(id: string, banned: boolean) {
    const ok = await call(
      `/admin/secondserve/users/${id}/ban`,
      { method: "PATCH", body: JSON.stringify({ banned }) },
      `ban:${id}`,
    );
    if (ok) {
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, banned } : u)));
    }
  }

  async function deleteUser(id: string) {
    if (!window.confirm(tt("confirmDeleteUser"))) return;
    const ok = await call(
      `/admin/secondserve/users/${id}`,
      { method: "DELETE" },
      `del:${id}`,
    );
    if (ok) {
      setUsers((prev) => prev.filter((u) => u.id !== id));
      setPartners((prev) => prev.filter((u) => u.id !== id));
    }
  }

  // ---- Order actions ----
  async function cancelOrder(id: string) {
    if (!window.confirm(tt("confirmCancelOrder"))) return;
    const ok = await call(
      `/admin/secondserve/orders/${id}/cancel`,
      { method: "PATCH" },
      `order:${id}`,
    );
    if (ok) {
      setOrders((prev) =>
        prev.map((o) => (o.id === id ? { ...o, status: "cancelled" } : o)),
      );
    }
  }

  // ---- Ticket actions ----
  const [replies, setReplies] = useState<Record<string, string>>({});
  async function resolveTicket(id: string) {
    const response = (replies[id] ?? "").trim();
    if (!response) {
      setError(tt("resolveNeedsResponse"));
      return;
    }
    const ok = await call(
      `/admin/secondserve/support/${id}/resolve`,
      { method: "PATCH", body: JSON.stringify({ response }) },
      `ticket:${id}`,
    );
    if (ok) {
      setTickets((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, status: "resolved", response } : t,
        ),
      );
      setReplies((prev) => ({ ...prev, [id]: "" }));
    }
  }

  const restaurantNameById = useMemo(() => {
    const map: Record<string, string> = {};
    partners.forEach((p) => (map[p.id] = p.name));
    return map;
  }, [partners]);

  const pendingPartners = partners.filter((p) => !p.approved);
  const approvedPartners = partners.filter((p) => p.approved);
  const openTickets = tickets.filter((t) => t.status === "pending").length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">{tt("title")}</h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            {tt("subtitle")}
          </p>
        </div>
      </div>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {/* KPI banner */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label={tt("kpis.accounts")} value={stats?.total_users ?? usersTotal} />
        <Kpi label={tt("kpis.partners")} value={stats?.total_partners ?? partners.length} />
        <Kpi label={tt("kpis.orders")} value={stats?.total_orders ?? ordersTotal} />
        <Kpi
          label={tt("kpis.revenue")}
          value={stats ? stats.revenue.toFixed(2) : "—"}
          accent="text-emerald-700"
        />
      </div>

      {/* Tabs */}
      <nav className="flex flex-wrap gap-1 border-b border-neutral-200">
        <TabButton active={tab === "dashboard"} onClick={() => setTab("dashboard")} label={tt("tabs.dashboard")} />
        <TabButton active={tab === "partners"} onClick={() => setTab("partners")} label={tt("tabs.partners")} count={pendingPartners.length} />
        <TabButton active={tab === "users"} onClick={() => setTab("users")} label={tt("tabs.users")} />
        <TabButton active={tab === "orders"} onClick={() => setTab("orders")} label={tt("tabs.orders")} />
        <TabButton active={tab === "support"} onClick={() => setTab("support")} label={tt("tabs.support")} count={openTickets} />
      </nav>

      {/* DASHBOARD */}
      {tab === "dashboard" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label={tt("dashboard.active")} value={stats?.active_orders ?? "—"} accent="text-blue-700" />
            <Kpi label={tt("dashboard.completed")} value={stats?.completed_orders ?? "—"} accent="text-emerald-700" />
            <Kpi label={tt("dashboard.cancelled")} value={stats?.cancelled_orders ?? "—"} accent="text-red-700" />
            <Kpi
              label={tt("dashboard.cancellationRate")}
              value={stats ? `${(stats.cancellation_rate * 100).toFixed(1)} %` : "—"}
            />
          </div>
          <div className="rounded-lg border border-neutral-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-neutral-900">
              {tt("dashboard.topProducts")}
            </h3>
            <p className="mb-4 text-xs text-neutral-500">
              {tt("dashboard.mealsRescued", { count: stats?.meals_rescued ?? 0 })}
            </p>
            {!stats || stats.popular_products.length === 0 ? (
              <p className="py-6 text-center text-sm text-neutral-400">
                {tt("dashboard.noSales")}
              </p>
            ) : (
              <ol className="space-y-2">
                {stats.popular_products.map((p, i) => (
                  <li
                    key={`${p.name}-${i}`}
                    className="flex items-center justify-between gap-3 rounded-lg bg-neutral-50 px-3 py-2"
                  >
                    <span className="flex items-center gap-3">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-200 text-xs font-bold text-neutral-600">
                        {i + 1}
                      </span>
                      <span className="text-sm font-medium text-neutral-800">
                        {p.name}
                      </span>
                      <span className="text-xs text-neutral-400">
                        {tt("dashboard.units", { count: p.count })}
                      </span>
                    </span>
                    <span className="font-mono text-sm font-semibold text-emerald-700">
                      {p.revenue.toFixed(2)} MAD
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      ) : null}

      {/* PARTNERS */}
      {tab === "partners" ? (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              {tt("partners.pendingApproval")}
            </h3>
            {pendingPartners.length === 0 ? (
              <EmptyBox text={tt("partners.noPending")} />
            ) : (
              pendingPartners.map((p) => (
                <div
                  key={p.id}
                  className="rounded-lg border border-amber-200 bg-amber-50/30 p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold text-neutral-900">
                      {p.name}
                    </span>
                    {p.commerce_type ? (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                        {p.commerce_type}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 font-mono text-xs text-neutral-500">{p.email}</p>
                  {p.address ? (
                    <p className="text-xs text-neutral-600">{p.address}</p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setApproval(p.id, true)}
                    disabled={busy === `partner:${p.id}`}
                    className="mt-3 w-full rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {busy === `partner:${p.id}` ? tt("partners.busy") : tt("partners.approve")}
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              {tt("partners.approved")}
            </h3>
            {approvedPartners.length === 0 ? (
              <EmptyBox text={tt("partners.noApproved")} />
            ) : (
              approvedPartners.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-4"
                >
                  <div>
                    <p className="text-sm font-semibold text-neutral-900">
                      {p.name}
                    </p>
                    <p className="font-mono text-xs text-neutral-500">{p.email}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setApproval(p.id, false)}
                    disabled={busy === `partner:${p.id}`}
                    className="rounded border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
                  >
                    {busy === `partner:${p.id}` ? tt("partners.busy") : tt("partners.suspend")}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      {/* USERS */}
      {tab === "users" ? (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-neutral-400">
                <th className="px-3 py-2 font-medium">{tt("users.table.user")}</th>
                <th className="px-3 py-2 font-medium">{tt("users.table.role")}</th>
                <th className="px-3 py-2 font-medium">{tt("users.table.city")}</th>
                <th className="px-3 py-2 font-medium">{tt("users.table.status")}</th>
                <th className="px-3 py-2 text-right font-medium">{tt("users.table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-sm text-neutral-400">
                    {tt("users.empty")}
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="border-t border-neutral-100 align-middle">
                    <td className="px-3 py-3">
                      <p className="text-sm font-medium text-neutral-900">{u.name}</p>
                      <p className="font-mono text-xs text-neutral-500">{u.email}</p>
                    </td>
                    <td className="px-3 py-3">
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
                        {u.role}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-sm text-neutral-600">
                      {u.city || "—"}
                    </td>
                    <td className="px-3 py-3">
                      {u.banned ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          {tt("users.banned")}
                        </span>
                      ) : (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          {tt("users.active")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {u.role === "admin" ? (
                        <span className="text-xs text-neutral-300">—</span>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setBan(u.id, !u.banned)}
                            disabled={busy === `ban:${u.id}`}
                            className={`rounded px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                              u.banned
                                ? "border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                                : "border border-red-300 text-red-700 hover:bg-red-50"
                            }`}
                          >
                            {busy === `ban:${u.id}`
                              ? tt("users.busy")
                              : u.banned
                                ? tt("users.unban")
                                : tt("users.ban")}
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteUser(u.id)}
                            disabled={busy === `del:${u.id}`}
                            className="rounded border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
                          >
                            {tt("users.delete")}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* ORDERS */}
      {tab === "orders" ? (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-neutral-400">
                <th className="px-3 py-2 font-medium">{tt("orders.table.refDate")}</th>
                <th className="px-3 py-2 font-medium">{tt("orders.table.client")}</th>
                <th className="px-3 py-2 font-medium">{tt("orders.table.partner")}</th>
                <th className="px-3 py-2 font-medium">{tt("orders.table.meal")}</th>
                <th className="px-3 py-2 font-medium">{tt("orders.table.amount")}</th>
                <th className="px-3 py-2 font-medium">{tt("orders.table.status")}</th>
                <th className="px-3 py-2 text-right font-medium">{tt("orders.table.action")}</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-neutral-400">
                    {tt("orders.empty")}
                  </td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr key={o.id} className="border-t border-neutral-100 align-top">
                    <td className="px-3 py-3">
                      <span className="block font-mono text-xs font-bold text-neutral-900">
                        #{o.id.slice(0, 8).toUpperCase()}
                      </span>
                      <span className="text-[10px] text-neutral-400">
                        {fmtDate(o.created_at, intlLocale)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-sm text-neutral-700">
                      {o.consumer_name || "—"}
                      {o.consumer_phone ? (
                        <span className="block font-mono text-[11px] text-neutral-400">
                          {o.consumer_phone}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-sm text-neutral-600">
                      {restaurantNameById[o.restaurant_id] ??
                        o.restaurant_id.slice(0, 8)}
                    </td>
                    <td className="px-3 py-3 text-sm text-neutral-700">
                      {o.offer_snapshot?.name ?? "—"}
                      <span className="block text-[10px] text-neutral-400">
                        x{o.quantity}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-sm font-semibold text-emerald-700">
                      {Number(o.total_price).toFixed(2)} MAD
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          ORDER_STATUS_CLS[o.status] ??
                          "bg-neutral-100 text-neutral-600"
                        }`}
                      >
                        {o.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      {o.status === "active" ? (
                        <button
                          type="button"
                          onClick={() => cancelOrder(o.id)}
                          disabled={busy === `order:${o.id}`}
                          className="rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          {busy === `order:${o.id}` ? tt("orders.busy") : tt("orders.cancel")}
                        </button>
                      ) : (
                        <span className="text-xs text-neutral-300">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* SUPPORT */}
      {tab === "support" ? (
        <div className="space-y-4">
          {tickets.length === 0 ? (
            <EmptyBox text={tt("support.empty")} />
          ) : (
            tickets.map((t) => (
              <div
                key={t.id}
                className={`rounded-lg border p-4 ${
                  t.status === "resolved"
                    ? "border-neutral-200 bg-neutral-50/40"
                    : "border-rose-200 bg-rose-50/20"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="block font-mono text-[10px] text-neutral-400">
                      {fmtDate(t.created_at, intlLocale)}
                    </span>
                    <h4 className="text-sm font-semibold text-neutral-900">
                      {t.subject}
                    </h4>
                  </div>
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                      t.status === "resolved"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-rose-100 text-rose-800"
                    }`}
                  >
                    {t.status === "resolved" ? tt("support.resolved") : tt("support.pending")}
                  </span>
                </div>
                <p className="mt-2 rounded border border-neutral-100 bg-white p-3 text-xs text-neutral-600">
                  {t.message}
                </p>
                <p className="mt-2 text-[11px] font-medium text-neutral-500">
                  {t.user_name} ({t.user_email}) · {t.user_role}
                </p>

                {t.status === "resolved" ? (
                  <div className="mt-3 rounded border border-emerald-100 bg-emerald-50/40 p-3 text-xs text-emerald-800">
                    <span className="font-semibold">{tt("support.responseLabel")}</span>
                    {t.response}
                  </div>
                ) : (
                  <div className="mt-3 flex gap-2">
                    <input
                      type="text"
                      value={replies[t.id] ?? ""}
                      onChange={(e) =>
                        setReplies((prev) => ({ ...prev, [t.id]: e.target.value }))
                      }
                      placeholder={tt("support.replyPlaceholder")}
                      className="flex-grow rounded border border-neutral-300 px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-rose-400"
                    />
                    <button
                      type="button"
                      onClick={() => resolveTicket(t.id)}
                      disabled={busy === `ticket:${t.id}`}
                      className="rounded bg-neutral-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
                    >
                      {busy === `ticket:${t.id}` ? tt("support.busy") : tt("support.resolve")}
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function Kpi({
  label,
  value,
  accent = "text-neutral-900",
}: {
  label: string;
  value: number | string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-neutral-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accent}`}>{value}</p>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-rose-600 text-rose-700"
          : "border-transparent text-neutral-500 hover:text-neutral-800"
      }`}
    >
      {label}
      {count && count > 0 ? (
        <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
          {count}
        </span>
      ) : null}
    </button>
  );
}

function EmptyBox({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-200 p-6 text-center text-sm text-neutral-400">
      {text}
    </div>
  );
}
