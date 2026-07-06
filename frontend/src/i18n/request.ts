import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";

// Messages are split into one file per top-level namespace (per locale) so
// unrelated sections (farmer/restaurant/admin/...) can be edited concurrently
// without touching a shared JSON file. Each namespace file contributes a
// disjoint set of top-level keys, so a shallow merge is enough here.
const NAMESPACES = [
  "core",
  "farmer",
  "restaurant",
  "admin",
  "citizen",
  "onboarding",
  "landingPage",
] as const;

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  const modules = await Promise.all(
    NAMESPACES.map((ns) => import(`./messages/${ns}/${locale}.json`)),
  );

  return {
    locale,
    messages: Object.assign({}, ...modules.map((m) => m.default)),
  };
});
