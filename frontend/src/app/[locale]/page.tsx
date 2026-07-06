import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

import { toIntlLocale } from "@/lib/intlLocale";
import {
  ArrowRight,
  Bell,
  Clock,
  Cpu,
  Gauge,
  Layers,
  MapPin,
  Recycle,
  Route,
  ShieldCheck,
  Sparkles,
  Sprout,
  Store,
  Truck,
  type LucideIcon,
} from "lucide-react";

import { Logo } from "./dashboard/farmer/_ui/Logo";
import {
  AnimatedGradientText,
  BlurFade,
  BorderBeam,
  FloatIn,
  GridPattern,
  Marquee,
  NumberTicker,
  ShineBorder,
  Spotlight,
} from "@/components/landing/effects";
import { LandingNav } from "@/components/landing/LandingNav";

/**
 * Public landing — VitaChain ecosystem.
 *
 * Presents the three real modules of the platform: Katara (IoT soil
 * monitoring), FarMarket (farmer→restaurant marketplace & logistics)
 * and SecondServe (surplus redistribution). Content stays truthful to
 * what the product does — no fake testimonials or invented metrics.
 *
 * Visual layer is built from hand-ported Magic UI / React Bits motion
 * primitives (see components/landing/effects) on top of our own design
 * tokens, animated with `motion`, iconography from `lucide-react`.
 */

export default function HomePage() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-white text-neutral-900">
      <LandingNav />

      <main>
        <Hero />
        <LogoMarquee />
        <Modules />
        <Flow />
        <Impact />
        <FinalCta />
      </main>

      <Footer />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

async function Hero() {
  const t = await getTranslations("landingPage.hero");
  return (
    <section className="relative isolate flex min-h-[92vh] items-center justify-center overflow-hidden">
      {/* Scenic background — /public/hero.jpg */}
      <Image
        src="/hero.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="-z-20 object-cover"
      />
      {/* Legibility overlays: full wash + a darker top band behind the nav. */}
      <div
        className="absolute inset-0 -z-10 bg-gradient-to-t from-leaf-900/80 via-black/35 to-black/40"
        aria-hidden
      />
      <div
        className="absolute inset-x-0 top-0 -z-10 h-40 bg-gradient-to-b from-black/45 to-transparent"
        aria-hidden
      />

      <div className="mx-auto w-full max-w-2xl px-4 pt-24 pb-16 text-center sm:px-6">
        <FloatIn delay={0.05}>
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-[11px] font-medium text-white ring-1 ring-white/30 backdrop-blur">
            <Sparkles size={12} />
            {t("badge")}
          </span>
        </FloatIn>

        <FloatIn delay={0.12}>
          <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight text-white [text-shadow:0_2px_24px_rgba(0,0,0,0.4)] sm:text-5xl">
            {t("titlePrefix")}{" "}
            <AnimatedGradientText
              from="oklch(0.94 0.07 152)"
              via="white"
              to="oklch(0.9 0.1 152)"
            >
              {t("titleHighlight")}
            </AnimatedGradientText>
            .
          </h1>
        </FloatIn>

        <FloatIn delay={0.2}>
          <p className="mx-auto mt-4 max-w-lg text-pretty text-sm leading-relaxed text-white/90 [text-shadow:0_1px_12px_rgba(0,0,0,0.35)] sm:text-base">
            {t("paragraph")}
          </p>
        </FloatIn>

        <FloatIn delay={0.28}>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-leaf-700 shadow-lifted transition-transform hover:-translate-y-0.5 active:translate-y-0"
            >
              {t("ctaPrimary")}
              <ArrowRight size={15} />
            </Link>
            <a
              href="#modules"
              className="inline-flex items-center gap-2 rounded-xl border border-white/50 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/15"
            >
              {t("ctaSecondary")}
            </a>
          </div>
        </FloatIn>

        <FloatIn delay={0.36}>
          <p className="mt-5 inline-flex items-center gap-2 text-[11px] font-medium text-white/80">
            <ShieldCheck size={13} className="text-leaf-200" />
            {t("trustLine")}
          </p>
        </FloatIn>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Marquee strip                                                       */
/* ------------------------------------------------------------------ */

async function LogoMarquee() {
  const t = await getTranslations("landingPage.marquee");
  const items: { icon: LucideIcon; label: string }[] = [
    { icon: Cpu, label: t("sensors") },
    { icon: Gauge, label: t("thresholds") },
    { icon: Bell, label: t("alerts") },
    { icon: Store, label: t("marketplace") },
    { icon: Truck, label: t("logistics") },
    { icon: MapPin, label: t("shortCircuit") },
    { icon: Recycle, label: t("antiWaste") },
    { icon: ShieldCheck, label: t("verifiedAccounts") },
  ];
  return (
    <section className="border-y border-neutral-100 bg-neutral-50/60 py-6">
      <div className="relative mx-auto max-w-6xl [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
        <Marquee duration="38s">
          {items.map((it) => (
            <span
              key={it.label}
              className="flex items-center gap-2 whitespace-nowrap text-sm font-medium text-neutral-500"
            >
              <it.icon size={16} className="text-leaf-600" />
              {it.label}
            </span>
          ))}
        </Marquee>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Modules                                                             */
/* ------------------------------------------------------------------ */

const MODULES = [
  {
    id: "katara",
    name: "Katara",
    logo: "/katara.png",
    accent: "text-leaf-700",
    tint: "bg-leaf-50",
    shine: { from: "#ffffff", to: "oklch(0.64 0.16 152)" }, // green
    soon: false,
  },
  {
    id: "farmarket",
    name: "FarMarket",
    logo: "/logo 2.png",
    accent: "text-soil-700",
    tint: "bg-soil-50",
    shine: { from: "#ffffff", to: "oklch(0.62 0.21 25)" }, // red
    soon: false,
  },
  {
    id: "botaba9a",
    name: "Botaba9a",
    logo: "/ragent.png",
    accent: "text-sky-tint-700",
    tint: "bg-sky-tint-50",
    shine: { from: "#ffffff", to: "oklch(0.58 0.18 250)" }, // blue
    soon: true,
  },
  {
    id: "secondserve",
    name: "SecondServe",
    logo: "/secondserve.png",
    accent: "text-warn-700",
    tint: "bg-warn-50",
    shine: { from: "#ffffff", to: "oklch(0.70 0.18 55)" }, // orange
    soon: false,
  },
] as const;

async function Modules() {
  const t = await getTranslations("landingPage.modules");
  return (
    <section id="modules" className="relative mx-auto max-w-6xl scroll-mt-24 px-4 py-24 sm:px-6">
      <SectionHeading
        eyebrow={t("heading.eyebrow")}
        title={t("heading.title")}
        subtitle={t("heading.subtitle")}
      />

      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {MODULES.map((m, i) => {
          const points = [
            t(`items.${m.id}.point1`),
            t(`items.${m.id}.point2`),
            t(`items.${m.id}.point3`),
          ];
          return (
            <BlurFade key={m.name} delay={0.1 + i * 0.08}>
              <Spotlight className="vc-card vc-card-interactive h-full rounded-3xl">
                <ShineBorder duration={6 + i} delay={i * 0.6} width={3} from={m.shine.from} to={m.shine.to} />
                <div className="relative p-6">
                  <div className="flex items-start justify-between">
                    <span className="grid h-14 w-14 place-items-center overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-neutral-100">
                      <Image
                        src={m.logo}
                        alt={m.name}
                        width={56}
                        height={56}
                        className="h-10 w-10 object-contain"
                      />
                    </span>
                    {m.soon && (
                      <span className="vc-pill vc-pill-warn text-[11px]">{t("soonBadge")}</span>
                    )}
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-neutral-900">{m.name}</h3>
                  <span className="mt-1 block text-xs font-medium text-neutral-500">
                    {t(`items.${m.id}.tag`)}
                  </span>
                  <p className="mt-3 text-sm leading-relaxed text-neutral-600">
                    {t(`items.${m.id}.desc`)}
                  </p>
                  <ul className="mt-5 space-y-2">
                    {points.map((p) => (
                      <li key={p} className="flex items-center gap-2 text-sm text-neutral-700">
                        <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${m.tint} ${m.accent}`}>
                          <Sparkles size={11} />
                        </span>
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              </Spotlight>
            </BlurFade>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* How it works                                                        */
/* ------------------------------------------------------------------ */

const STEPS = [
  { id: "cultivate", icon: Sprout },
  { id: "sell", icon: Store },
  { id: "deliver", icon: Truck },
  { id: "valorize", icon: Recycle },
] as const;

async function Flow() {
  const t = await getTranslations("landingPage.flow");
  return (
    <section id="flow" className="relative scroll-mt-24 overflow-hidden bg-neutral-50/70 py-24">
      <GridPattern size={48} className="text-leaf-900/[0.03]" />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow={t("heading.eyebrow")}
          title={t("heading.title")}
          subtitle={t("heading.subtitle")}
        />

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <BlurFade key={s.id} delay={0.08 * i}>
              <div className="vc-card h-full rounded-2xl p-6">
                <div className="flex items-center justify-between">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-leaf-50 text-leaf-700">
                    <s.icon size={22} />
                  </span>
                  <span className="text-3xl font-semibold text-leaf-100">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="mt-4 text-base font-semibold text-neutral-900">
                  {t(`steps.${s.id}.title`)}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-neutral-600">
                  {t(`steps.${s.id}.desc`)}
                </p>
              </div>
            </BlurFade>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Impact / stats                                                      */
/* ------------------------------------------------------------------ */

async function Impact() {
  const t = await getTranslations("landingPage.impact");
  const intlLocale = toIntlLocale(await getLocale());
  const stats = [
    {
      id: "modules",
      icon: Layers,
      value: 4,
      suffix: "",
      accent: "text-leaf-700",
      tint: "bg-leaf-50",
      glow: "oklch(0.64 0.16 152 / 0.22)",
    },
    {
      id: "soilParams",
      icon: Gauge,
      value: 3,
      suffix: "",
      accent: "text-sky-tint-700",
      tint: "bg-sky-tint-50",
      glow: "oklch(0.62 0.13 220 / 0.22)",
    },
    {
      id: "monitoring",
      icon: Clock,
      value: 24,
      suffix: "/7",
      accent: "text-warn-700",
      tint: "bg-warn-50",
      glow: "oklch(0.80 0.15 80 / 0.24)",
    },
    {
      id: "tracedChain",
      icon: Route,
      value: 100,
      suffix: " %",
      accent: "text-soil-700",
      tint: "bg-soil-50",
      glow: "oklch(0.64 0.12 60 / 0.24)",
    },
  ] as const;
  return (
    <section id="impact" className="relative scroll-mt-24 overflow-hidden py-24">
      <GridPattern
        size={48}
        className="text-leaf-900/[0.03] [mask-image:radial-gradient(70%_60%_at_50%_40%,black,transparent)]"
      />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow={t("heading.eyebrow")}
          title={t("heading.title")}
          subtitle={t("heading.subtitle")}
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s, i) => (
            <BlurFade key={s.id} delay={0.08 * i}>
              <div className="vc-card vc-card-interactive group relative h-full overflow-hidden rounded-3xl p-6 text-center sm:p-7">
                <div
                  aria-hidden
                  className="pointer-events-none absolute -top-10 left-1/2 h-28 w-28 -translate-x-1/2 rounded-full opacity-70 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
                  style={{ background: `radial-gradient(circle, ${s.glow}, transparent 70%)` }}
                />
                <span className={`relative mx-auto grid h-12 w-12 place-items-center rounded-2xl ${s.tint} ${s.accent}`}>
                  <s.icon size={22} />
                </span>
                <p className={`relative mt-4 text-4xl font-semibold tracking-tight sm:text-5xl ${s.accent}`}>
                  <NumberTicker value={s.value} suffix={s.suffix} locale={intlLocale} />
                </p>
                <p className="relative mt-1.5 text-sm font-semibold text-neutral-800">
                  {t(`stats.${s.id}.label`)}
                </p>
                <p className="relative mt-0.5 text-xs text-neutral-500">
                  {t(`stats.${s.id}.caption`)}
                </p>
              </div>
            </BlurFade>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Final CTA                                                           */
/* ------------------------------------------------------------------ */

async function FinalCta() {
  const t = await getTranslations("landingPage.finalCta");
  return (
    <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
      <BlurFade>
        <div className="relative isolate overflow-hidden rounded-[2rem] bg-gradient-to-br from-leaf-700 via-leaf-600 to-leaf-800 px-6 py-16 text-center shadow-lifted sm:px-12 sm:py-20">
          <GridPattern size={40} className="text-white/[0.07]" />
          <BorderBeam size={140} duration={10} from="oklch(0.95 0.05 152)" to="oklch(0.82 0.10 220)" />
          <div className="relative mx-auto max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {t("title")}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-leaf-50/90">
              {t("paragraph")}
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/register"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-leaf-700 shadow-soft transition-transform hover:-translate-y-0.5"
              >
                {t("ctaPrimary")}
                <ArrowRight size={16} />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-xl border border-white/30 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                {t("ctaSecondary")}
              </Link>
            </div>
          </div>
        </div>
      </BlurFade>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Shared                                                              */
/* ------------------------------------------------------------------ */

function SectionHeading({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <BlurFade>
      <div className="mx-auto max-w-2xl text-center">
        <span className="vc-eyebrow">{eyebrow}</span>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-900 sm:text-4xl">
          {title}
        </h2>
        <p className="mt-4 text-pretty leading-relaxed text-neutral-600">{subtitle}</p>
      </div>
    </BlurFade>
  );
}

async function Footer() {
  const t = await getTranslations("landingPage.footer");
  return (
    <footer className="border-t border-neutral-100 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-12 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="max-w-sm">
          <Logo size="sm" />
          <p className="mt-3 text-sm leading-relaxed text-neutral-500">
            {t("description")}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-10 gap-y-4 text-sm">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              {t("modulesHeading")}
            </span>
            <a href="#modules" className="text-neutral-600 hover:text-leaf-700">Katara</a>
            <a href="#modules" className="text-neutral-600 hover:text-leaf-700">FarMarket</a>
            <a href="#modules" className="text-neutral-600 hover:text-leaf-700">Botaba9a</a>
            <a href="#modules" className="text-neutral-600 hover:text-leaf-700">SecondServe</a>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              {t("accountHeading")}
            </span>
            <Link href="/login" className="text-neutral-600 hover:text-leaf-700">{t("login")}</Link>
            <Link href="/register" className="text-neutral-600 hover:text-leaf-700">{t("register")}</Link>
          </div>
        </div>
      </div>
      <div className="border-t border-neutral-100 py-5">
        <p className="mx-auto max-w-6xl px-4 text-center text-xs text-neutral-400 sm:px-6">
          {t("copyright", { year: new Date().getFullYear() })}
        </p>
      </div>
    </footer>
  );
}
