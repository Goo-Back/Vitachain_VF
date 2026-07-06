import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["fr", "en", "ar"],
  defaultLocale: "fr",
  // Every URL carries its locale segment (/fr/..., /en/..., /ar/...) — no bare
  // "/dashboard" for the default locale. Pre-launch (robots: noindex), so
  // there's no existing SEO/links to preserve, and this keeps the middleware
  // fusion with Supabase auth (middleware.ts) unambiguous: the locale-stripped
  // pathname is always a simple prefix removal.
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];
