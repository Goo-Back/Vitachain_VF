import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

import { PageHeader } from "@/app/[locale]/dashboard/farmer/_ui/PageHeader";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  InfoIcon,
  PackageIcon,
  SatelliteIcon,
  ShoppingBagIcon,
  StoreIcon,
} from "@/app/[locale]/dashboard/farmer/_ui/Icon";

export const dynamic = "force-dynamic";

export default async function HelpPage() {
  const t = await getTranslations("restaurant");
  return (
    <div className="mx-auto max-w-3xl vc-fade-in">
      <PageHeader
        crumbs={[
          { label: t("common.crumbRestaurant"), href: "/dashboard/restaurant" },
          { label: t("help.crumbHelp") },
        ]}
        eyebrow={t("help.eyebrow")}
        title={t("help.title")}
        subtitle={t("help.subtitle")}
      />

      <section className="vc-card p-6">
        <h2 className="text-base font-semibold text-neutral-900">
          {t("help.processTitle")}
        </h2>
        <ol className="mt-4 space-y-4">
          <ProcessStep
            n={1}
            icon={<StoreIcon size={16} className="text-leaf-700" />}
            title={t("help.step1Title")}
            body={t("help.step1Body")}
          />
          <ProcessStep
            n={2}
            icon={<ShoppingBagIcon size={16} className="text-leaf-700" />}
            title={t("help.step2Title")}
            body={t("help.step2Body")}
          />
          <ProcessStep
            n={3}
            icon={<SatelliteIcon size={16} className="text-leaf-700" />}
            title={t("help.step3Title")}
            body={t("help.step3Body")}
          />
          <ProcessStep
            n={4}
            icon={<PackageIcon size={16} className="text-leaf-700" />}
            title={t("help.step4Title")}
            body={t("help.step4Body")}
          />
        </ol>
      </section>

      <section className="mt-6 vc-card p-6">
        <h2 className="text-base font-semibold text-neutral-900">
          {t("help.whyAnonymityTitle")}
        </h2>
        <p className="mt-2 text-sm text-neutral-700">
          {t("help.whyAnonymityBody")}
        </p>
        <ul className="mt-4 space-y-2 text-sm text-neutral-700">
          <li className="flex items-start gap-2">
            <CheckCircleIcon size={16} className="mt-0.5 text-leaf-700" />
            {t("help.bullet1")}
          </li>
          <li className="flex items-start gap-2">
            <CheckCircleIcon size={16} className="mt-0.5 text-leaf-700" />
            {t("help.bullet2")}
          </li>
          <li className="flex items-start gap-2">
            <CheckCircleIcon size={16} className="mt-0.5 text-leaf-700" />
            {t("help.bullet3")}
          </li>
        </ul>
      </section>

      <section className="mt-6 vc-card p-6">
        <h2 className="text-base font-semibold text-neutral-900">
          {t("help.faqTitle")}
        </h2>
        <div className="mt-4 space-y-4 divide-y divide-neutral-100">
          <Faq q={t("help.faq1Q")} a={t("help.faq1A")} />
          <Faq q={t("help.faq2Q")} a={t("help.faq2A")} />
          <Faq q={t("help.faq3Q")} a={t("help.faq3A")} />
          <Faq q={t("help.faq4Q")} a={t("help.faq4A")} />
          <Faq q={t("help.faq5Q")} a={t("help.faq5A")} />
          <Faq q={t("help.faq6Q")} a={t("help.faq6A")} />
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-leaf-100 bg-leaf-50/60 p-5">
        <div className="flex items-start gap-3">
          <InfoIcon size={18} className="mt-0.5 text-leaf-700" />
          <div>
            <p className="text-sm font-semibold text-leaf-800">
              {t("help.ctaTitle")}
            </p>
            <p className="mt-1 text-sm text-leaf-700">
              {t("help.ctaBody")}
            </p>
            <Link
              href="/dashboard/restaurant/settings"
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-leaf-800 hover:underline"
            >
              {t("help.ctaLink")} <ArrowRightIcon size={14} className="rtl:-scale-x-100" />
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
