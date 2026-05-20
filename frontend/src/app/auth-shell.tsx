import Link from "next/link";

import {
  CheckCircleIcon,
  DropletIcon,
  SparkleIcon,
  SproutIcon,
} from "./dashboard/farmer/_ui/Icon";
import { Logo } from "./dashboard/farmer/_ui/Logo";

/**
 * Split-screen shell used by /login and /register.
 *
 * Left column: form (passed as children).
 * Right column: decorative panel — gradient + abstract field illustration +
 * 3 bullet points of value prop. Hidden on small screens to keep the form
 * vertically centred on phones.
 */

export function AuthShell({
  children,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* LEFT — form column */}
      <div className="flex flex-col px-6 py-10 sm:px-10 lg:px-16">
        <Link href="/" className="inline-flex">
          <Logo size="sm" />
        </Link>
        <div className="mx-auto my-auto w-full max-w-md py-12">
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-2 text-sm text-neutral-600">{subtitle}</p>
          ) : null}
          <div className="mt-8">{children}</div>
        </div>
        <p className="text-center text-xs text-neutral-400">
          © {new Date().getFullYear()} VitaChain · Katara
        </p>
      </div>

      {/* RIGHT — decorative panel */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-leaf-700 via-leaf-600 to-leaf-800 lg:block">
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-sun-500/20 blur-3xl" />
        <DecorativeArtwork />
        <div className="relative z-10 flex h-full flex-col justify-between p-12 text-white">
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs ring-1 ring-white/20">
            <SparkleIcon size={12} /> Suite Katara · IoT agricole
          </span>
          <div>
            <h2 className="text-3xl font-semibold leading-tight">
              Votre sol parle.
              <br /> Nous le traduisons en décisions.
            </h2>
            <ul className="mt-8 space-y-4 text-sm text-white/85">
              <Bullet icon={<DropletIcon size={16} />}>
                Suivi en direct de l&apos;humidité, du pH et de la conductivité.
              </Bullet>
              <Bullet icon={<SproutIcon size={16} />}>
                Alertes par parcelle, avant que la culture ne souffre.
              </Bullet>
              <Bullet icon={<CheckCircleIcon size={16} />}>
                Recommandations IA contextuelles & traçabilité complète.
              </Bullet>
            </ul>
          </div>
          <blockquote className="rounded-xl bg-white/10 p-5 text-sm text-white/90 ring-1 ring-white/15">
            <p>
              « En une saison, j&apos;ai économisé 30 % d&apos;eau sur mes serres
              et perdu zéro plant à cause d&apos;un stress hydrique. »
            </p>
            <footer className="mt-3 text-xs text-white/70">
              — Karim B., maraîcher, Meknès
            </footer>
          </blockquote>
        </div>
      </aside>
    </div>
  );
}

function Bullet({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-full bg-white/15 ring-1 ring-white/20">
        {icon}
      </span>
      <span>{children}</span>
    </li>
  );
}

function DecorativeArtwork() {
  // Subtle, repeating "fields seen from above" pattern.
  return (
    <svg
      aria-hidden
      className="absolute inset-0 h-full w-full opacity-[0.06]"
      viewBox="0 0 200 200"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <pattern id="rows" width="20" height="20" patternUnits="userSpaceOnUse" patternTransform="rotate(20)">
          <path d="M0 10 H20" stroke="white" strokeWidth="0.6" fill="none" />
          <path d="M0 14 H20" stroke="white" strokeWidth="0.4" fill="none" />
        </pattern>
      </defs>
      <rect width="200" height="200" fill="url(#rows)" />
    </svg>
  );
}
