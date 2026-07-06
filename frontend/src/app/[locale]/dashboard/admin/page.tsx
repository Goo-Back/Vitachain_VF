import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { getServerSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function fetchCount(path: string, token: string): Promise<number | null> {
  try {
    const res = await fetch(`${API_BASE}/api/v1${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (Array.isArray(body)) return body.length;
    if (typeof body?.total === "number") return body.total;
    return null;
  } catch {
    return null;
  }
}

type Card = {
  href: string;
  title: string;
  description: string;
  metric: number | null;
  metricLabel: string;
  accent: string;
};

export default async function AdminHomePage() {
  const t = await getTranslations("admin.overview");
  const session = await getServerSession();
  const token = session?.access_token ?? "";

  const [pendingKyc, usersTotal, ordersStats, ssUsers] = await Promise.all([
    fetchCount("/admin/kyc/pending", token),
    fetchCount("/admin/users?page_size=1", token),
    fetchCount("/admin/farmarket/orders?page_size=1", token),
    fetchCount("/admin/secondserve/users?page_size=1", token),
  ]);

  const cards: Card[] = [
    {
      href: "/dashboard/admin/verifications",
      title: t("cards.kyc.title"),
      description: t("cards.kyc.description"),
      metric: pendingKyc,
      metricLabel: t("cards.kyc.metricLabel"),
      accent: "text-amber-700",
    },
    {
      href: "/dashboard/admin/users",
      title: t("cards.users.title"),
      description: t("cards.users.description"),
      metric: usersTotal,
      metricLabel: t("cards.users.metricLabel"),
      accent: "text-blue-700",
    },
    {
      href: "/dashboard/admin/farmarket",
      title: t("cards.farmarket.title"),
      description: t("cards.farmarket.description"),
      metric: ordersStats,
      metricLabel: t("cards.farmarket.metricLabel"),
      accent: "text-emerald-700",
    },
    {
      href: "/dashboard/admin/secondserve",
      title: t("cards.secondserve.title"),
      description: t("cards.secondserve.description"),
      metric: ssUsers,
      metricLabel: t("cards.secondserve.metricLabel"),
      accent: "text-rose-700",
    },
  ];

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-neutral-900">
          {t("title")}
        </h1>
        <p className="mt-0.5 text-sm text-neutral-500">
          {t("subtitle")}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group rounded-xl border border-neutral-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-neutral-900">
                {card.title}
              </h2>
              <span className={`text-2xl font-bold ${card.accent}`}>
                {card.metric ?? "—"}
              </span>
            </div>
            <p className="mt-1 text-xs uppercase tracking-wide text-neutral-400">
              {card.metricLabel}
            </p>
            <p className="mt-3 text-sm text-neutral-500">{card.description}</p>
            <span className="mt-4 inline-block text-sm font-medium text-neutral-700 group-hover:text-neutral-900">
              {t("open")}
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
