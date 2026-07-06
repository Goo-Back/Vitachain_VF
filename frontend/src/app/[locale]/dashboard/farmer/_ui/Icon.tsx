import type { SVGProps } from "react";

/**
 * Katara icon system — Material Symbols Outlined (variable font).
 *
 * All icons are rendered via the MIcon base component which drives the
 * four variable axes of the font:
 *   FILL  0|1          — outlined vs filled glyph
 *   wght  100–700      — stroke weight (300 = refined, 400 = default)
 *   GRAD  -50–200      — grade (contrast, leave at 0)
 *   opsz  20|24|40|48  — optical size (auto-selected from `size` prop)
 *
 * Named exports keep the same prop shape as the old Lucide wrappers
 * ({ size?, className?, strokeWidth? }) so every consumer compiles
 * without changes. `strokeWidth` is silently ignored — use `weight` for
 * fine-tuning stroke thickness.
 */

/* ── Base component ──────────────────────────────────────────────── */

export type IconProps = {
  size?: number;
  className?: string;
  /** Material Symbols fill axis — true = solid glyph, false = outlined. */
  fill?: boolean;
  /** Material Symbols weight axis (100–700). Default: 400. */
  weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700;
  /** Ignored — kept for drop-in compatibility with Lucide consumers. */
  strokeWidth?: number;
};

export function MIcon({
  name,
  size = 20,
  fill = false,
  weight = 400,
  className = "",
}: IconProps & { name: string }) {
  /* Optical size — matches the rendering grid the designers intended. */
  const opsz = size <= 20 ? 20 : size <= 24 ? 24 : size <= 40 ? 40 : 48;
  return (
    <span
      className={`material-symbols-outlined notranslate ${className}`}
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' ${weight}, 'GRAD' 0, 'opsz' ${opsz}`,
      }}
      // The glyph is a ligature keyed off the literal `name` text (e.g.
      // "chevron_right"). Browser/extension translators (Google Translate)
      // don't know that and rewrite it as prose, breaking the ligature and
      // rendering literal translated text instead of the icon.
      translate="no"
      aria-hidden="true"
    >
      {name}
    </span>
  );
}

/* ── Factory ─────────────────────────────────────────────────────── */

function icon(name: string, defaultFill = false, defaultWeight: IconProps["weight"] = 400) {
  const Comp = ({
    size = 20,
    className,
    fill,
    weight,
    strokeWidth: _ignored,
  }: IconProps) => (
    <MIcon
      name={name}
      size={size}
      fill={fill ?? defaultFill}
      weight={weight ?? defaultWeight}
      className={className}
    />
  );
  Comp.displayName = `Icon(${name})`;
  return Comp;
}

/* ── Agriculture & environment ───────────────────────────────────── */
export const LeafIcon       = icon("eco",            true);   // filled leaf / eco
export const SproutIcon     = icon("potted_plant",   true);   // sprout in a pot
export const DropletIcon    = icon("water_drop",     true);   // water drop
export const ThermometerIcon= icon("device_thermostat", false);
export const WindIcon       = icon("air",            false);

/* ── Weather ─────────────────────────────────────────────────────── */
export const SunIcon        = icon("wb_sunny",       true);
export const CloudIcon      = icon("cloud",          true);
export const CloudRainIcon  = icon("rainy",          true);

/* ── IoT / sensors ───────────────────────────────────────────────── */
export const SensorsIcon    = icon("sensors",        true);
export const SensorsOffIcon = icon("sensors_off",    true);
export const ActivityIcon   = icon("monitoring",     false);  // live activity chart
export const CpuIcon        = icon("memory",         true);   // chip / MCU

/* ── Mapping / parcels ───────────────────────────────────────────── */
export const MapIcon        = icon("map",            true);   // filled territory map
export const MapPinIcon     = icon("location_on",    true);   // single point pin
export const RulerIcon      = icon("square_foot",    false);  // area measurement

/* ── Status / alerts ─────────────────────────────────────────────── */
export const AlertIcon      = icon("warning",        true);
export const CheckCircleIcon= icon("check_circle",   true);
export const InfoIcon       = icon("info",           true);
export const ShieldAlertIcon= icon("emergency_home", true);   // breach alert
export const ShieldCheckIcon= icon("health_and_safety", true); // all-clear shield
export const BellRingIcon   = icon("notifications_active", true);

/* ── Navigation ──────────────────────────────────────────────────── */
export const HomeIcon       = icon("home",           true);
export const ChevronRightIcon= icon("chevron_right", false);
export const ChevronDownIcon= icon("expand_more",    false);
export const ArrowRightIcon = icon("arrow_forward",  false);
export const ArrowUpRightIcon= icon("arrow_outward", false);
export const MenuIcon       = icon("menu",           false);
export const XIcon          = icon("close",          false);

/* ── Actions ─────────────────────────────────────────────────────── */
export const PlusIcon       = icon("add",            false);
export const SearchIcon     = icon("search",         false);
export const FilterIcon     = icon("filter_list",    false);
export const DownloadIcon   = icon("download",       false);
export const EditIcon       = icon("edit",           false);
export const TrashIcon      = icon("delete",         false);
export const LogoutIcon     = icon("logout",         false);
export const SettingsIcon   = icon("settings",       false);

/* ── Data / analytics ────────────────────────────────────────────── */
export const ChartIcon      = icon("show_chart",     false);
export const SparkleIcon    = icon("auto_awesome",   true);
export const SatelliteIcon  = icon("satellite_alt",  true);
export const ClockIcon      = icon("schedule",       true);
export const CalendarIcon   = icon("calendar_month", true);
export const BellIcon       = icon("notifications",  true);

/* ── Commerce / social ───────────────────────────────────────────── */
export const StoreIcon      = icon("storefront",     true);
export const ShoppingBagIcon= icon("shopping_bag",   true);
export const PackageIcon    = icon("inventory_2",    true);
export const TagIcon        = icon("label",          true);
export const ImageIcon      = icon("image",          true);
export const UsersIcon      = icon("group",          true);

/**
 * Katara brand mark — custom SVG pinwheel (water drop + leaves).
 * Kept as inline SVG so it works without the icon font (favicons, monochrome
 * contexts). The full-colour raster logo lives in <KataraLogo />.
 */
export const VitaLogoMark = ({
  size = 20,
  ...rest
}: SVGProps<SVGSVGElement> & { size?: number }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    {...rest}
  >
    <path d="M12 2.2l3.6 5.4A4.3 4.3 0 1112 14.1a4.3 4.3 0 01-3.6-6.5L12 2.2z" opacity="0.9" />
    <path d="M3 12.2l4.7 4.7L12 12.2l-4.3-4.3L3 12.2z" opacity="0.55" />
    <path d="M21 12.2l-4.7 4.7L12 12.2l4.3-4.3L21 12.2z" opacity="0.55" />
    <path d="M12 16.4l3 3-3 3-3-3 3-3z" opacity="0.7" />
  </svg>
);
