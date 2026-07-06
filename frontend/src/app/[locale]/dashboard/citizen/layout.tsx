import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";

import { getServerProfile, getServerSession } from "@/lib/auth/session";

import { ShellClient } from "./_ui/ShellClient";

export const dynamic = "force-dynamic";

export default async function CitizenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const session = await getServerSession();
  if (!session) return redirect({ href: "/login", locale });

  const profile = await getServerProfile();
  if (profile?.role !== "CITIZEN") return redirect({ href: "/dashboard", locale });

  return (
    <div className="theme-farmarket min-h-screen bg-neutral-50">
      <ShellClient>
        <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8">{children}</main>
      </ShellClient>
    </div>
  );
}
