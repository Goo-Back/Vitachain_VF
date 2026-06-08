import Link from "next/link";

import { PageHeader } from "@/app/dashboard/farmer/_ui/PageHeader";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  InfoIcon,
  PackageIcon,
  SatelliteIcon,
  ShoppingBagIcon,
  StoreIcon,
} from "@/app/dashboard/farmer/_ui/Icon";

export const dynamic = "force-dynamic";

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl vc-fade-in">
      <PageHeader
        crumbs={[
          { label: "Restaurateur", href: "/dashboard/restaurant" },
          { label: "Aide" },
        ]}
        eyebrow="Aide"
        title="Comment fonctionne FarMarket ?"
        subtitle="VitaChain est l'intermédiaire logistique entre les producteurs agricoles marocains et les restaurateurs. Nous ne mettons jamais les deux parties en contact direct."
      />

      <section className="vc-card p-6">
        <h2 className="text-base font-semibold text-neutral-900">
          Le parcours d&apos;achat en 4 étapes
        </h2>
        <ol className="mt-4 space-y-4">
          <ProcessStep
            n={1}
            icon={<StoreIcon size={16} className="text-leaf-700" />}
            title="Parcourez le catalogue"
            body="Filtrez par région, prix au kilo et type de produit. Sauvegardez les annonces intéressantes dans vos favoris."
          />
          <ProcessStep
            n={2}
            icon={<ShoppingBagIcon size={16} className="text-leaf-700" />}
            title="Composez votre panier"
            body="Vous pouvez mélanger plusieurs producteurs dans une même commande — nous coordonnons les ramassages pour vous."
          />
          <ProcessStep
            n={3}
            icon={<SatelliteIcon size={16} className="text-leaf-700" />}
            title="VitaChain prend en charge la livraison"
            body="Nous transmettons votre commande aux producteurs (anonymisée), récupérons les marchandises et organisons le transport vers votre établissement."
          />
          <ProcessStep
            n={4}
            icon={<PackageIcon size={16} className="text-leaf-700" />}
            title="Recevez et confirmez la livraison"
            body="Vérifiez la conformité à la réception. En cas de litige, contactez le support VitaChain — vous n'avez jamais à gérer le producteur directement."
          />
        </ol>
      </section>

      <section className="mt-6 vc-card p-6">
        <h2 className="text-base font-semibold text-neutral-900">
          Pourquoi l&apos;anonymat ?
        </h2>
        <p className="mt-2 text-sm text-neutral-700">
          En masquant l&apos;identité des producteurs et celle des
          restaurateurs, VitaChain protège chaque partie contre les pratiques
          commerciales déloyales (prix bradés, démarchage direct, rupture de
          contrat). C&apos;est ce qui garantit un prix juste à la production et
          une qualité contrôlée pour vos cuisines.
        </p>
        <ul className="mt-4 space-y-2 text-sm text-neutral-700">
          <li className="flex items-start gap-2">
            <CheckCircleIcon size={16} className="mt-0.5 text-leaf-700" />
            Vos coordonnées (nom, téléphone, adresse) ne sont jamais transmises
            aux producteurs.
          </li>
          <li className="flex items-start gap-2">
            <CheckCircleIcon size={16} className="mt-0.5 text-leaf-700" />
            L&apos;identité des producteurs n&apos;est révélée qu&apos;à la
            livraison via le bon de livraison.
          </li>
          <li className="flex items-start gap-2">
            <CheckCircleIcon size={16} className="mt-0.5 text-leaf-700" />
            Les notes de livraison sont filtrées pour ne pas exposer
            d&apos;informations de contact.
          </li>
        </ul>
      </section>

      <section className="mt-6 vc-card p-6">
        <h2 className="text-base font-semibold text-neutral-900">
          Questions fréquentes
        </h2>
        <div className="mt-4 space-y-4 divide-y divide-neutral-100">
          <Faq
            q="Quels sont les frais logistique ?"
            a="5 % du sous-total avec un minimum de 50 MAD par commande. Ce montant couvre le ramassage, le transport et la qualité de la marchandise jusqu'à votre porte."
          />
          <Faq
            q="Quels sont les délais de livraison ?"
            a="24 à 48 h en moyenne selon la région. Les commandes de la zone Casa/Rabat sont généralement livrées le lendemain. Vous pouvez suivre l'avancement depuis la page de votre commande."
          />
          <Faq
            q="Comment puis-je payer ?"
            a="Deux modes disponibles : (1) Paiement à la livraison, en espèces ou par chèque libellé à l'ordre de VitaChain, remis au livreur contre reçu signé. (2) Virement sécurisé via PayMaroc, notre prestataire de paiement agréé Bank Al-Maghrib — vous réglez en ligne par carte ou virement instantané avant que la commande ne soit transmise aux producteurs."
          />
          <Faq
            q="Puis-je annuler une commande ?"
            a="Oui, tant que la commande est au statut « En attente ». Une fois acceptée par les producteurs, une annulation peut être facturée."
          />
          <Faq
            q="Que faire si la marchandise n'est pas conforme ?"
            a="Refusez la livraison à la réception ou contactez VitaChain dans les 24 h. Nous gérons le litige avec le producteur — vous êtes intégralement remboursé en cas de défaut avéré."
          />
          <Faq
            q="Comment contacter le support ?"
            a="Email : support@vitachain.ma · Téléphone : +212 5 22 00 00 00 (Lun-Sam 8h-19h)."
          />
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-leaf-100 bg-leaf-50/60 p-5">
        <div className="flex items-start gap-3">
          <InfoIcon size={18} className="mt-0.5 text-leaf-700" />
          <div>
            <p className="text-sm font-semibold text-leaf-800">
              Besoin d&apos;aller plus loin ?
            </p>
            <p className="mt-1 text-sm text-leaf-700">
              Activez votre compte vérifié pour augmenter vos plafonds de
              commande et accéder aux producteurs premium.
            </p>
            <Link
              href="/dashboard/restaurant/settings"
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-leaf-800 hover:underline"
            >
              Aller dans les paramètres <ArrowRightIcon size={14} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function ProcessStep({
  n,
  icon,
  title,
  body,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li className="flex gap-4">
      <div className="flex flex-col items-center">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-leaf-600 text-xs font-semibold text-white">
          {n}
        </span>
      </div>
      <div className="flex-1">
        <p className="flex items-center gap-2 text-sm font-medium text-neutral-900">
          {icon}
          {title}
        </p>
        <p className="mt-1 text-sm text-neutral-600">{body}</p>
      </div>
    </li>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="group pt-4">
      <summary className="flex cursor-pointer items-center justify-between text-sm font-medium text-neutral-900 marker:hidden">
        <span>{q}</span>
        <span className="text-neutral-400 group-open:rotate-180 transition">
          ⌄
        </span>
      </summary>
      <p className="mt-2 text-sm text-neutral-600">{a}</p>
    </details>
  );
}
