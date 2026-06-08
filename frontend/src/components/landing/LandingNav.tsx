"use client";

import Link from "next/link";
import { ArrowRight, Menu, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

import { Logo } from "@/app/dashboard/farmer/_ui/Logo";

const LINKS = [
  { href: "#modules", label: "Modules" },
  { href: "#flow", label: "Fonctionnement" },
  { href: "#impact", label: "Impact" },
];

/**
 * Public landing navigation. Turns into a frosted, bordered bar once the
 * page scrolls; collapses to a sheet menu on small screens.
 */
export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <nav
        className={`mx-auto flex max-w-6xl items-center justify-between px-4 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] sm:px-6 ${
          scrolled
            ? "mt-2 h-12 rounded-full border border-white/40 bg-white/55 shadow-soft backdrop-blur-xl sm:mx-6"
            : "h-16 border border-transparent"
        }`}
      >
        <Link href="/" className="inline-flex">
          <Logo size="sm" tone={scrolled ? "default" : "white"} />
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                scrolled
                  ? "text-neutral-600 hover:bg-leaf-50 hover:text-leaf-700"
                  : "text-white/85 hover:bg-white/10 hover:text-white"
              }`}
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className={`hidden text-sm font-medium transition-colors sm:inline ${
              scrolled
                ? "text-neutral-700 hover:text-leaf-700"
                : "text-white/90 hover:text-white"
            }`}
          >
            Connexion
          </Link>
          <Link href="/register" className="vc-btn-primary !rounded-xl">
            Commencer
            <ArrowRight size={15} />
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
            className={`grid h-10 w-10 place-items-center rounded-xl border transition-colors md:hidden ${
              scrolled
                ? "border-neutral-200 bg-white text-neutral-700"
                : "border-white/30 bg-white/10 text-white backdrop-blur"
            }`}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="mx-4 mt-2 rounded-2xl border border-leaf-100 bg-white/95 p-2 shadow-card backdrop-blur-xl md:hidden"
          >
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="block rounded-xl px-4 py-3 text-sm font-medium text-neutral-700 hover:bg-leaf-50 hover:text-leaf-700"
              >
                {l.label}
              </a>
            ))}
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="block rounded-xl px-4 py-3 text-sm font-medium text-neutral-700 hover:bg-leaf-50 hover:text-leaf-700"
            >
              Connexion
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
