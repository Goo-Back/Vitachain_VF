import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Locale-aware drop-in replacements for next/link, useRouter, usePathname,
// redirect — these automatically prefix hrefs with the current locale so
// existing call sites don't need to hand-manage the /fr, /en, /ar segment.
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
