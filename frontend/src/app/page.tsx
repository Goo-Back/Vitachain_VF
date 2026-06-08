import Image from "next/image";
import Link from "next/link";
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

function Hero() {
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
            Écosystème anti-gaspillage agro-alimentaire
          </span>
        </FloatIn>

        <FloatIn delay={0.12}>
          <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight text-white [text-shadow:0_2px_24px_rgba(0,0,0,0.4)] sm:text-5xl">
            Du sol à l&apos;assiette,{" "}
            <AnimatedGradientText
              from="oklch(0.94 0.07 152)"
              via="white"
              to="oklch(0.9 0.1 152)"
            >
              zéro maillon perdu
            </AnimatedGradientText>
            .
          </h1>
        </FloatIn>

        <FloatIn delay={0.2}>
          <p className="mx-auto mt-4 max-w-lg text-pretty text-sm leading-relaxed text-white/90 [text-shadow:0_1px_12px_rgba(0,0,0,0.35)] sm:text-base">
            VitaChain relie agriculteurs et restaurateurs autour d&apos;une
            chaîne courte et tracée&nbsp;: surveillance IoT, place de marché
            logistique et redistribution des surplus — sur une seule
            plateforme.
          </p>
        </FloatIn>

        <FloatIn delay={0.28}>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-leaf-700 shadow-lifted transition-transform hover:-translate-y-0.5 active:translate-y-0"
            >
              Créer mon compte
              <ArrowRight size={15} />
            </Link>
            <a
              href="#modules"
              className="inline-flex items-center gap-2 rounded-xl border border-white/50 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/15"
            >
              Découvrir les modules
            </a>
          </div>
        </FloatIn>

        <FloatIn delay={0.36}>
          <p className="mt-5 inline-flex items-center gap-2 text-[11px] font-medium text-white/80">
            <ShieldCheck size={13} className="text-leaf-200" />
            Comptes vérifiés · chaîne tracée de bout en bout
          </p>
        </FloatIn>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Marquee strip                                                       */
/* ------------------------------------------------------------------ */

function LogoMarquee() {
  const items: { icon: LucideIcon; label: string }[] = [
    { icon: Cpu, label: "Capteurs ESP32" },
    { icon: Gauge, label: "Seuils par parcelle" },
    { icon: Bell, label: "Alertes en temps réel" },
    { icon: Store, label: "Place de marché" },
    { icon: Truck, label: "Suivi logistique" },
    { icon: MapPin, label: "Circuit court" },
    { icon: Recycle, label: "Anti-gaspillage" },
    { icon: ShieldCheck, label: "Comptes vérifiés" },
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
    name: "Katara",
    tag: "Suivi IoT du sol",
    logo: "/katara.png",
    accent: "text-leaf-700",
    tint: "bg-leaf-50",
    shine: { from: "#ffffff", to: "oklch(0.64 0.16 152)" }, // green
    soon: false,
    desc: "Vos capteurs ESP32 remontent humidité, pH et conductivité par parcelle. Définissez vos seuils et obtenez un diagnostic agronomique à la demande.",
    points: ["Mesures temps réel", "Seuils personnalisés", "Diagnostic à la demande"],
  },
  {
    name: "FarMarket",
    tag: "Place de marché & logistique",
    logo: "/FarMarket.png",
    accent: "text-soil-700",
    tint: "bg-soil-50",
    shine: { from: "#ffffff", to: "oklch(0.62 0.21 25)" }, // red
    soon: false,
    desc: "Les restaurateurs commandent directement aux producteurs. VitaChain orchestre la logistique et le suivi de commande, du champ jusqu'au comptoir.",
    points: ["Catalogue producteurs", "Pipeline de commandes", "Suivi de livraison"],
  },
  {
    name: "Botaba9a",
    tag: "Traçabilité chaîne du froid",
    logo: "/Botaba9a.png",
    accent: "text-sky-tint-700",
    tint: "bg-sky-tint-50",
    shine: { from: "#ffffff", to: "oklch(0.58 0.18 250)" }, // blue
    soon: true,
    desc: "Suivez la température du transport au stockage : une chaîne du froid tracée de bout en bout pour garantir la fraîcheur et la sécurité des produits.",
    points: ["Suivi de température", "Alertes rupture de froid", "Historique traçable"],
  },
  {
    name: "SecondServe",
    tag: "Redistribution des surplus",
    logo: "/secondserve.png",
    accent: "text-warn-700",
    tint: "bg-warn-50",
    shine: { from: "#ffffff", to: "oklch(0.70 0.18 55)" }, // orange
    soon: false,
    desc: "Les invendus et surplus deviennent des offres à prix réduit pour les partenaires : moins de pertes, plus de valeur rendue à la filière.",
    points: ["Offres de surplus", "Partenaires approuvés", "Impact mesuré"],
  },
];

function Modules() {
  return (
    <section id="modules" className="relative mx-auto max-w-6xl scroll-mt-24 px-4 py-24 sm:px-6">
      <SectionHeading
        eyebrow="Quatre modules, une plateforme"
        title="Une chaîne agro-alimentaire complète"
        subtitle="Chaque module fonctionne seul — ensemble, ils couvrent tout le parcours, de la culture à la consommation."
      />

      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {MODULES.map((m, i) => (
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
                    <span className="vc-pill vc-pill-warn text-[11px]">Bientôt</span>
                  )}
                </div>
                <h3 className="mt-5 text-lg font-semibold text-neutral-900">{m.name}</h3>
                <span className="mt-1 block text-xs font-medium text-neutral-500">{m.tag}</span>
                <p className="mt-3 text-sm leading-relaxed text-neutral-600">{m.desc}</p>
                <ul className="mt-5 space-y-2">
                  {m.points.map((p) => (
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
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* How it works                                                        */
/* ------------------------------------------------------------------ */

const STEPS = [
  { icon: Sprout, title: "Cultivez & mesurez", desc: "Katara surveille le sol en continu et vous alerte dès qu'un seuil est franchi." },
  { icon: Store, title: "Vendez en direct", desc: "Publiez votre récolte sur FarMarket ; les restaurateurs commandent en quelques clics." },
  { icon: Truck, title: "Livrez & suivez", desc: "La logistique est orchestrée et tracée jusqu'à la réception de la commande." },
  { icon: Recycle, title: "Valorisez les surplus", desc: "Les invendus repartent via SecondServe au lieu d'être jetés." },
];

function Flow() {
  return (
    <section id="flow" className="relative scroll-mt-24 overflow-hidden bg-neutral-50/70 py-24">
      <GridPattern size={48} className="text-leaf-900/[0.03]" />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Comment ça marche"
          title="Quatre étapes, un circuit vertueux"
          subtitle="VitaChain raccourcit la chaîne et garde chaque maillon connecté au suivant."
        />

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <BlurFade key={s.title} delay={0.08 * i}>
              <div className="vc-card h-full rounded-2xl p-6">
                <div className="flex items-center justify-between">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-leaf-50 text-leaf-700">
                    <s.icon size={22} />
                  </span>
                  <span className="text-3xl font-semibold text-leaf-100">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="mt-4 text-base font-semibold text-neutral-900">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-neutral-600">{s.desc}</p>
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

function Impact() {
  const stats = [
    {
      icon: Layers,
      value: 4,
      suffix: "",
      label: "Modules intégrés",
      caption: "Une plateforme unifiée",
      accent: "text-leaf-700",
      tint: "bg-leaf-50",
      glow: "oklch(0.64 0.16 152 / 0.22)",
    },
    {
      icon: Gauge,
      value: 3,
      suffix: "",
      label: "Paramètres de sol",
      caption: "Humidité · pH · conductivité",
      accent: "text-sky-tint-700",
      tint: "bg-sky-tint-50",
      glow: "oklch(0.62 0.13 220 / 0.22)",
    },
    {
      icon: Clock,
      value: 24,
      suffix: "/7",
      label: "Supervision continue",
      caption: "Données en temps réel",
      accent: "text-warn-700",
      tint: "bg-warn-50",
      glow: "oklch(0.80 0.15 80 / 0.24)",
    },
    {
      icon: Route,
      value: 100,
      suffix: " %",
      label: "Chaîne tracée",
      caption: "Du champ à l'assiette",
      accent: "text-soil-700",
      tint: "bg-soil-50",
      glow: "oklch(0.64 0.12 60 / 0.24)",
    },
  ];
  return (
    <section id="impact" className="relative scroll-mt-24 overflow-hidden py-24">
      <GridPattern
        size={48}
        className="text-leaf-900/[0.03] [mask-image:radial-gradient(70%_60%_at_50%_40%,black,transparent)]"
      />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Notre raison d'être"
          title="Moins de gaspillage, plus de valeur"
          subtitle="Une filière mieux connectée perd moins — au champ comme en cuisine."
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s, i) => (
            <BlurFade key={s.label} delay={0.08 * i}>
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
                  <NumberTicker value={s.value} suffix={s.suffix} />
                </p>
                <p className="relative mt-1.5 text-sm font-semibold text-neutral-800">{s.label}</p>
                <p className="relative mt-0.5 text-xs text-neutral-500">{s.caption}</p>
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

function FinalCta() {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
      <BlurFade>
        <div className="relative isolate overflow-hidden rounded-[2rem] bg-gradient-to-br from-leaf-700 via-leaf-600 to-leaf-800 px-6 py-16 text-center shadow-lifted sm:px-12 sm:py-20">
          <GridPattern size={40} className="text-white/[0.07]" />
          <BorderBeam size={140} duration={10} from="oklch(0.95 0.05 152)" to="oklch(0.82 0.10 220)" />
          <div className="relative mx-auto max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Rejoignez la chaîne VitaChain
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-leaf-50/90">
              Agriculteur ou restaurateur, créez votre compte et reprenez la
              main sur votre filière — du suivi des cultures à la lutte contre
              le gaspillage.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/register"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-leaf-700 shadow-soft transition-transform hover:-translate-y-0.5"
              >
                Commencer gratuitement
                <ArrowRight size={16} />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-xl border border-white/30 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                J&apos;ai déjà un compte
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

function Footer() {
  return (
    <footer className="border-t border-neutral-100 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-12 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="max-w-sm">
          <Logo size="sm" />
          <p className="mt-3 text-sm leading-relaxed text-neutral-500">
            L&apos;écosystème anti-gaspillage agro-alimentaire — du champ au
            tableau de bord, du producteur au restaurateur.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-10 gap-y-4 text-sm">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Modules
            </span>
            <a href="#modules" className="text-neutral-600 hover:text-leaf-700">Katara</a>
            <a href="#modules" className="text-neutral-600 hover:text-leaf-700">FarMarket</a>
            <a href="#modules" className="text-neutral-600 hover:text-leaf-700">Botaba9a</a>
            <a href="#modules" className="text-neutral-600 hover:text-leaf-700">SecondServe</a>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Compte
            </span>
            <Link href="/login" className="text-neutral-600 hover:text-leaf-700">Connexion</Link>
            <Link href="/register" className="text-neutral-600 hover:text-leaf-700">Inscription</Link>
          </div>
        </div>
      </div>
      <div className="border-t border-neutral-100 py-5">
        <p className="mx-auto max-w-6xl px-4 text-center text-xs text-neutral-400 sm:px-6">
          © {new Date().getFullYear()} VitaChain · Écosystème anti-gaspillage agro-alimentaire
        </p>
      </div>
    </footer>
  );
}
