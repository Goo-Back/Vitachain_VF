import Link from "next/link";

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
  const session = await getServerSession();
  const token = session?.access_token ?? "";

  const [pendingKyc, usersTotal, ordersStats] = await Promise.all([
    fetchCount("/admin/kyc/pending", token),
    fetchCount("/admin/users?page_size=1", token),
    fetchCount("/admin/farmarket/orders?page_size=1", token),
  ]);

  const cards: Card[] = [
    {
      href: "/dashboard/admin/verifications",
      title: "Vérifications KYC",
      description: "Examiner les documents soumis et approuver ou rejeter.",
      metric: pendingKyc,
      metricLabel: "en attente",
      accent: "text-amber-700",
    },
    {
      href: "/dashboard/admin/users",
      title: "Utilisateurs",
      description: "Rechercher, changer les rôles, bannir ou réactiver.",
      metric: usersTotal,
      metricLabel: "comptes",
      accent: "text-blue-700",
    },
    {
      href: "/dashboard/admin/farmarket",
      title: "FarMarket",
      description: "Annonces, commandes, réconciliation des paiements COD.",
      metric: ordersStats,
      metricLabel: "commandes",
      accent: "text-emerald-700",
    },
  ];

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-neutral-900">
          Console d&apos;administration
        </h1>
        <p className="mt-0.5 text-sm text-neutral-500">
          Vue d&apos;ensemble des outils de gestion de la plateforme.
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
              Ouvrir →
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
