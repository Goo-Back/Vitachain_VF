import { Link } from "@/i18n/navigation";
import {
  Leaf,
  Recycle,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Sprout,
  Store,
  type LucideIcon,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Logo } from "./[locale]/dashboard/farmer/_ui/Logo";
import {
  AnimatedGradientText,
  BlurFade,
  FloatIn,
  GridPattern,
} from "@/components/landing/effects";

/**
 * Split-screen shell used by /login and /register.
 *
 * Left column: the form (passed as children), centred and animated in.
 * Right column: a decorative panel for the VitaChain *ecosystem* — not a
 * single module. It surfaces the four modules (Katara, FarMarket,
 * BotaBa9a, SecondServe) and the platform's anti-waste mission, so the
 * auth pages frame VitaChain as the whole food chain "du champ à
 * l'assiette" rather than just the Katara soil-IoT product. Hidden below
 * lg so the form stays vertically centred on phones.
 */

const MODULE_DEFS: {
  icon: LucideIcon;
  name: string;
  tagKey: "katara" | "farmarket" | "botaba9a" | "secondserve";
  soon?: boolean;
}[] = [
  { icon: Sprout, name: "Katara", tagKey: "katara" },
  { icon: Store, name: "FarMarket", tagKey: "farmarket" },
  { icon: Snowflake, name: "Botaba9a", tagKey: "botaba9a", soon: true },
  { icon: Recycle, name: "SecondServe", tagKey: "secondserve" },
];

export async function AuthShell({
  children,
  title,
  subtitle,
  badge,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  badge?: string;
}) {
  const t = await getTranslations("auth.shell");
  const resolvedBadge = badge ?? t("defaultBadge");
  const MODULES = MODULE_DEFS.map((m) => ({ ...m, tag: t(`modules.${m.tagKey}`) }));
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* LEFT — form column */}
      <div className="relative flex flex-col px-6 py-8 sm:px-10 lg:px-16">
        {/* Soft brand wash behind the form on mobile. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,var(--color-leaf-50),transparent_70%)] lg:hidden"
        />

        <Link href="/" className="inline-flex w-fit">
          <Logo size="sm" />
        </Link>

        <div className="mx-auto my-auto w-full max-w-md py-10">
          <FloatIn delay={0.04}>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-leaf-50 px-3 py-1 text-xs font-medium text-leaf-700 ring-1 ring-leaf-100">
              <Sparkles size={12} />
              {resolvedBadge}
            </span>
          </FloatIn>

          <FloatIn delay={0.1}>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-neutral-900 sm:text-[2rem]">
              {title}
            </h1>
          </FloatIn>

          {subtitle ? (
            <FloatIn delay={0.16}>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600">
                {subtitle}
              </p>
            </FloatIn>
          ) : null}

          <FloatIn delay={0.22}>
            <div className="mt-8">{children}</div>
          </FloatIn>
        </div>

        <p className="text-center text-xs text-neutral-400">
          © {new Date().getFullYear()} VitaChain · {t("footer")}
        </p>
      </div>

      {/* RIGHT — decorative ecosystem panel */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-leaf-700 via-leaf-600 to-leaf-800 lg:block">
        <div aria-hidden className="vc-aurora absolute inset-0 opacity-40" />
        <div
          aria-hidden
          className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-sun-500/20 blur-3xl"
        />
        <GridPattern size={44} className="text-white/[0.06]" />

        <div className="relative z-10 flex h-full flex-col justify-between p-12 text-white">
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs ring-1 ring-white/20 backdrop-blur">
            <Leaf size={12} /> {t("rightPanelBadge")}
          </span>

          <div>
            <BlurFade delay={0.1}>
              <h2 className="max-w-md text-[2rem] font-semibold leading-tight">
                {t("headingStart")}{" "}
                <AnimatedGradientText
                  from="oklch(0.95 0.06 152)"
                  via="white"
                  to="oklch(0.9 0.1 152)"
                >
                  {t("headingHighlight")}
                </AnimatedGradientText>
                .
              </h2>
            </BlurFade>

            <BlurFade delay={0.18}>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-white/80">
                {t("paragraph")}
              </p>
            </BlurFade>

            {/* The four modules — VitaChain is the ecosystem, not one product. */}
            <div className="mt-7 grid max-w-md grid-cols-2 gap-3">
              {MODULES.map((m, i) => (
                <ModuleCard key={m.name} {...m} soonLabel={t("soon")} delay={0.24 + i * 0.07} />
              ))}
            </div>
          </div>

          <BlurFade delay={0.3}>
            <div className="max-w-md rounded-2xl bg-white/10 p-5 ring-1 ring-white/15 backdrop-blur">
              <p className="text-sm leading-relaxed text-white/90">
                {t("statCard")}
              </p>
              <p className="mt-3 inline-flex items-center gap-2 text-xs text-white/70">
                <ShieldCheck size={13} className="text-leaf-200" />
                {t("verifiedFooter")}
              </p>
            </div>
          </BlurFade>
        </div>
      </aside>
    </div>
  );
}

function ModuleCard({
  icon: Icon,
  name,
  tag,
  soon,
  soonLabel,
  delay,
}: {
  icon: LucideIcon;
  name: string;
  tag: string;
  soon?: boolean;
  soonLabel: string;
  delay: number;
}) {
  return (
    <FloatIn delay={delay}>
      <div className="flex h-full items-start gap-3 rounded-2xl bg-white/10 p-3.5 ring-1 ring-white/15 backdrop-blur transition-colors hover:bg-white/15">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/15 text-white ring-1 ring-white/20">
          <Icon size={18} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold leading-none">{name}</p>
            {soon ? (
              <span className="rounded-full bg-sun-500/30 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-sun-50 ring-1 ring-sun-500/30">
                {soonLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[11px] leading-tight text-white/70">{tag}</p>
        </div>
      </div>
    </FloatIn>
  );
}
