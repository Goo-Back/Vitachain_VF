import Link from "next/link";

import {
  AlertIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  DropletIcon,
  MapPinIcon,
  SparkleIcon,
  SproutIcon,
} from "./_ui/Icon";

/**
 * KAT-14 — empty-state for a freshly-onboarded FARMER (zero parcels).
 *
 * Visual upgrade: instead of plain text, present a welcome card with the
 * value prop, a CTA, and a "what you'll be able to do" feature strip — so
 * the empty state actually sells the next action.
 */

export function EmptyState() {
  return (
    <div className="mx-auto max-w-4xl py-8">
      <div className="vc-card relative overflow-hidden p-8 sm:p-12">
        <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-leaf-100/60 blur-3xl" />
        <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-soil-100/60 blur-3xl" />

        <div className="relative">
          <span className="inline-flex items-center gap-2 rounded-full bg-leaf-50 px-3 py-1 text-xs font-medium text-leaf-700">
            <SproutIcon size={12} /> Première étape
          </span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-neutral-900 sm:text-4xl">
            Bienvenue sur Katara.
          </h1>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-neutral-600">
            Vous n&apos;avez pas encore enregistré de parcelle. Créez-en une
            pour associer un capteur ESP32 et démarrer la surveillance de
            votre sol en direct.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/dashboard/farmer/parcels/new"
              className="vc-btn-primary"
            >
              Créer ma première parcelle
              <ArrowRightIcon size={14} />
            </Link>
            <a
              href="#"
              className="vc-btn-ghost"
            >
              Voir le guide de démarrage
            </a>
          </div>
        </div>

        <ul className="relative mt-10 grid gap-4 sm:grid-cols-3">
          <Feature
            icon={<MapPinIcon size={18} className="text-leaf-700" />}
            tint="bg-leaf-50"
            title="Renseignez la parcelle"
            desc="Nom, culture et surface. 30 secondes."
          />
          <Feature
            icon={<DropletIcon size={18} className="text-sky-tint-700" />}
            tint="bg-sky-tint-50"
            title="Branchez le capteur"
            desc="Pairing par code à 6 chiffres."
          />
          <Feature
            icon={<SparkleIcon size={18} className="text-leaf-700" />}
            tint="bg-leaf-50"
            title="Recevez vos premiers conseils"
            desc="Diagnostic IA dès la première mesure."
          />
        </ul>

        <div className="relative mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-neutral-100 pt-6 text-xs text-neutral-500">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircleIcon size={14} className="text-leaf-600" /> Gratuit pendant 30 jours
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CheckCircleIcon size={14} className="text-leaf-600" /> Sans engagement
          </span>
          <span className="inline-flex items-center gap-1.5">
            <AlertIcon size={14} className="text-warn-600" />
            La vérification d&apos;identité est nécessaire pour appairer un capteur.
          </span>
        </div>
      </div>
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
    <li className="rounded-xl border border-neutral-100 bg-white/70 p-4">
      <span className={`grid h-9 w-9 place-items-center rounded-lg ${tint}`}>
        {icon}
      </span>
      <p className="mt-3 text-sm font-medium text-neutral-900">{title}</p>
      <p className="mt-0.5 text-xs text-neutral-500">{desc}</p>
    </li>
  );
}
