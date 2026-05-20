import Link from "next/link";

import {
  ArrowRightIcon,
  CheckCircleIcon,
  DropletIcon,
  SparkleIcon,
  SproutIcon,
} from "./dashboard/farmer/_ui/Icon";
import { Logo } from "./dashboard/farmer/_ui/Logo";

/**
 * Public landing — intentionally minimal.
 *
 * What we put here only reflects what Katara actually does today:
 *   - Monitor soil parameters (humidity, pH, conductivity) via an ESP32.
 *   - Define per-parcel thresholds and surface breaches.
 *   - Generate an on-demand diagnostic from the recorded telemetry.
 *
 * No fake testimonials, partner logos, pricing tiers, or marketing
 * features. Add those back the day they become true.
 */

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-neutral-100">
        <nav className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="inline-flex">
            <Logo size="sm" />
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="hidden text-sm font-medium text-neutral-700 hover:text-leaf-700 sm:inline"
            >
              Connexion
            </Link>
            <Link href="/register" className="vc-btn-primary">
              Commencer
              <ArrowRightIcon size={14} />
            </Link>
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
        <section className="vc-hero-bg -mx-4 -mt-16 px-4 pt-16 pb-12 sm:-mx-6 sm:px-6 sm:pt-24 sm:pb-16">
          <div className="mx-auto max-w-3xl text-center">
            <span className="vc-pill vc-pill-leaf">
              <SproutIcon size={12} /> Module Katara · suivi IoT du sol
            </span>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-neutral-900 sm:text-5xl">
              Surveillez votre sol,{" "}
              <span className="text-leaf-700">parcelle par parcelle</span>.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-neutral-600">
              Katara connecte vos capteurs ESP32 au cloud et vous donne accès,
              en temps réel, à l&apos;humidité, au pH et à la conductivité de
              votre sol. Définissez vos seuils, recevez un diagnostic à la
              demande, agissez en confiance.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link href="/register" className="vc-btn-primary">
                Créer mon exploitation
                <ArrowRightIcon size={14} />
              </Link>
              <Link href="/login" className="vc-btn-ghost">
                J&apos;ai déjà un compte
              </Link>
            </div>
          </div>
        </section>

        <section className="mt-16 grid gap-5 sm:grid-cols-3">
          <Feature
            icon={<DropletIcon size={22} className="text-sky-tint-700" />}
            tint="bg-sky-tint-50"
            title="Mesures temps réel"
            desc="Humidité, pH et conductivité relevés par votre ESP32 et stockés par parcelle."
          />
          <Feature
            icon={<CheckCircleIcon size={22} className="text-warn-700" />}
            tint="bg-warn-50"
            title="Seuils personnalisés"
            desc="Définissez vos plages idéales pour chaque parcelle ; les dépassements sont surfacés."
          />
          <Feature
            icon={<SparkleIcon size={22} className="text-leaf-700" />}
            tint="bg-leaf-50"
            title="Diagnostic à la demande"
            desc="Un résumé agronomique généré à partir de votre télémétrie, archivable et consultable."
          />
        </section>
      </main>

      <footer className="border-t border-neutral-100 py-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 text-xs text-neutral-500 sm:px-6">
          <p>© {new Date().getFullYear()} VitaChain · Module Katara</p>
          <p>Suivi sol IoT — du champ au tableau de bord.</p>
        </div>
      </footer>
    </div>
  );
}

function Feature({
  icon,
  tint,
  title,
  desc,
}: {
  icon: React.ReactNode;
  tint: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="vc-card p-5">
      <span className={`grid h-10 w-10 place-items-center rounded-lg ${tint}`}>
        {icon}
      </span>
      <h3 className="mt-3 text-base font-semibold text-neutral-900">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-neutral-600">{desc}</p>
    </div>
  );
}
