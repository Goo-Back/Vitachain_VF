import type { SVGProps } from "react";

/**
 * Inline SVG icon set — no external dependency, tree-shakes cleanly.
 * All icons are 24x24 viewBox, currentColor stroke, 1.6 weight to match
 * the dashboard's medium contrast.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 20, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const LeafIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M11 20A7 7 0 014 13c0-6 5-10 16-10-1 11-5 16-10 16z" />
    <path d="M4 21l9-9" />
  </Base>
);

export const SproutIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 22V11" />
    <path d="M3 11h2a4 4 0 014 4v2a4 4 0 01-4-4H3z" transform="rotate(-30 6 13)" />
    <path d="M21 7h-2a4 4 0 00-4 4v0a4 4 0 004-4h2z" />
  </Base>
);

export const DropletIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 2.5l5.5 8.2A6.5 6.5 0 1112 21a6.5 6.5 0 01-5.5-10.3L12 2.5z" />
  </Base>
);

export const ThermometerIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M14 14.8V4a2 2 0 10-4 0v10.8a4 4 0 104 0z" />
  </Base>
);

export const SunIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </Base>
);

export const CloudIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M17 18a4 4 0 000-8 5 5 0 00-9.6 1.3A3.5 3.5 0 007 18h10z" />
  </Base>
);

export const CloudRainIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M17 14a4 4 0 000-8 5 5 0 00-9.6 1.3A3.5 3.5 0 007 14h10z" />
    <path d="M8 17v3M12 17v3M16 17v3" />
  </Base>
);

export const WindIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 9h12a3 3 0 100-6 3 3 0 00-3 3" />
    <path d="M3 15h16a3 3 0 110 6 3 3 0 01-3-3" />
    <path d="M3 12h9" />
  </Base>
);

export const MapPinIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 22s7-6.5 7-12a7 7 0 10-14 0c0 5.5 7 12 7 12z" />
    <circle cx="12" cy="10" r="2.5" />
  </Base>
);

export const HomeIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 11l9-7 9 7v9a2 2 0 01-2 2h-4v-7H9v7H5a2 2 0 01-2-2v-9z" />
  </Base>
);

export const ChartIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 3v18h18" />
    <path d="M7 15l3-3 3 3 5-7" />
  </Base>
);

export const BellIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 8a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6z" />
    <path d="M10 20a2 2 0 004 0" />
  </Base>
);

export const CalendarIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M16 3v4M8 3v4M3 11h18" />
  </Base>
);

export const SparkleIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3l1.8 4.7L18 9.5l-4.2 1.8L12 16l-1.8-4.7L6 9.5l4.2-1.8L12 3z" />
    <path d="M19 14l.7 1.8L21.5 16.5l-1.8.7L19 19l-.7-1.8L16.5 16.5l1.8-.7L19 14z" />
  </Base>
);

export const ShoppingBagIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 8h14l-1 12a2 2 0 01-2 2H8a2 2 0 01-2-2L5 8z" />
    <path d="M9 8V6a3 3 0 016 0v2" />
  </Base>
);

export const UsersIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="9" cy="8" r="4" />
    <path d="M2 21a7 7 0 0114 0" />
    <path d="M16 3.5a4 4 0 010 8" />
    <path d="M22 21a6 6 0 00-4-5.6" />
  </Base>
);

export const SettingsIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.9.3l-.1.1A2 2 0 113.1 17l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H2a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.9l-.1-.1A2 2 0 116 3.1l.1.1a1.7 1.7 0 001.9.3H8a1.7 1.7 0 001-1.5V2a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1A2 2 0 1120.9 6l-.1.1a1.7 1.7 0 00-.3 1.9V8a1.7 1.7 0 001.5 1H22a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
  </Base>
);

export const PlusIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
  </Base>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M9 6l6 6-6 6" />
  </Base>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 9l6 6 6-6" />
  </Base>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Base>
);

export const ArrowUpRightIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M7 17L17 7" />
    <path d="M9 7h8v8" />
  </Base>
);

export const SearchIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </Base>
);

export const LogoutIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
    <path d="M16 17l5-5-5-5M21 12H9" />
  </Base>
);

export const AlertIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M10.3 3.86a2 2 0 013.4 0l8.2 13.2a2 2 0 01-1.7 3.04H3.8a2 2 0 01-1.7-3.04L10.3 3.86z" />
    <path d="M12 9v4M12 17h.01" />
  </Base>
);

export const CheckCircleIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.5l3 3 5-6" />
  </Base>
);

export const InfoIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6M12 7h.01" />
  </Base>
);

export const FilterIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 4h16l-6 8v6l-4 2v-8L4 4z" />
  </Base>
);

export const DownloadIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
  </Base>
);

export const MenuIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Base>
);

export const XIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Base>
);

export const SatelliteIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 19l-2 2" />
    <path d="M8 15l5 5" />
    <path d="M9 11l4 4" />
    <path d="M14 6l4 4" />
    <path d="M16 4l4 4-3 3-4-4 3-3z" />
    <path d="M7 13l-3 3 4 4 3-3" />
    <path d="M12 8l-4 4" />
  </Base>
);

export const EditIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
  </Base>
);

export const TrashIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </Base>
);

export const VitaLogoMark = (p: IconProps) => (
  <Base {...p}>
    {/* Stylised leaf forming a "V". */}
    <path d="M4 4c0 9 4 16 8 16s8-7 8-16c-5 0-8 4-8 9 0-5-3-9-8-9z" />
    <path d="M12 20V11" />
  </Base>
);

export const StoreIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 7h16l-1.5 9a2 2 0 01-2 1.8H7.5A2 2 0 015.5 16L4 7z" />
    <path d="M4 7l1-4h14l1 4" />
    <path d="M10 12h4" />
  </Base>
);

export const TagIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M20.6 8.3L12 3 3.4 8.3a1 1 0 00-.4.8V21a1 1 0 001 1h16a1 1 0 001-1V9.1a1 1 0 00-.4-.8z" />
    <path d="M12 3v7" />
    <circle cx="12" cy="14" r="2" />
  </Base>
);

export const ImageIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="M21 15l-5-5L5 21" />
  </Base>
);

export const PackageIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
    <path d="M3.3 7l8.7 5 8.7-5M12 22V12" />
  </Base>
);

export const ClockIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </Base>
);
