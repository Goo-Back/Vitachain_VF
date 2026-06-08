import type { SVGProps } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Cloud,
  CloudRain,
  Download,
  Droplet,
  Filter,
  Home,
  Image as ImageLucide,
  Info,
  Leaf,
  LineChart,
  LogOut,
  MapPin,
  Menu,
  Package,
  Pencil,
  Plus,
  Satellite,
  Search,
  Settings,
  ShoppingBag,
  Sparkles,
  Sprout,
  Store,
  Sun,
  Tag,
  Thermometer,
  Trash2,
  Users,
  Wind,
  X,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

/**
 * Dashboard icon set — backed by lucide-react.
 *
 * Historically these were hand-rolled inline SVGs; they're now thin
 * wrappers around lucide so the whole dashboard shares a single,
 * professionally-drawn icon family. The public API is unchanged
 * (`<MapPinIcon size={18} className="…" />`) so no consuming page needed
 * to be touched. A slightly lighter default `strokeWidth` (1.75 vs
 * lucide's 2) keeps the refined, low-contrast feel the agri-tech chrome
 * was built around.
 */

export type IconProps = LucideProps & { size?: number };

function styled(Icon: LucideIcon, name: string) {
  const Styled = ({ size = 20, strokeWidth = 1.75, ...rest }: IconProps) => (
    <Icon size={size} strokeWidth={strokeWidth} aria-hidden="true" {...rest} />
  );
  Styled.displayName = `Icon(${name})`;
  return Styled;
}

export const LeafIcon = styled(Leaf, "Leaf");
export const SproutIcon = styled(Sprout, "Sprout");
export const DropletIcon = styled(Droplet, "Droplet");
export const ThermometerIcon = styled(Thermometer, "Thermometer");
export const SunIcon = styled(Sun, "Sun");
export const CloudIcon = styled(Cloud, "Cloud");
export const CloudRainIcon = styled(CloudRain, "CloudRain");
export const WindIcon = styled(Wind, "Wind");
export const MapPinIcon = styled(MapPin, "MapPin");
export const HomeIcon = styled(Home, "Home");
export const ChartIcon = styled(LineChart, "LineChart");
export const BellIcon = styled(Bell, "Bell");
export const CalendarIcon = styled(Calendar, "Calendar");
export const SparkleIcon = styled(Sparkles, "Sparkles");
export const ShoppingBagIcon = styled(ShoppingBag, "ShoppingBag");
export const UsersIcon = styled(Users, "Users");
export const SettingsIcon = styled(Settings, "Settings");
export const PlusIcon = styled(Plus, "Plus");
export const ChevronRightIcon = styled(ChevronRight, "ChevronRight");
export const ChevronDownIcon = styled(ChevronDown, "ChevronDown");
export const ArrowRightIcon = styled(ArrowRight, "ArrowRight");
export const ArrowUpRightIcon = styled(ArrowUpRight, "ArrowUpRight");
export const SearchIcon = styled(Search, "Search");
export const LogoutIcon = styled(LogOut, "LogOut");
export const AlertIcon = styled(AlertTriangle, "AlertTriangle");
export const CheckCircleIcon = styled(CheckCircle2, "CheckCircle2");
export const InfoIcon = styled(Info, "Info");
export const FilterIcon = styled(Filter, "Filter");
export const DownloadIcon = styled(Download, "Download");
export const MenuIcon = styled(Menu, "Menu");
export const XIcon = styled(X, "X");
export const SatelliteIcon = styled(Satellite, "Satellite");
export const EditIcon = styled(Pencil, "Pencil");
export const TrashIcon = styled(Trash2, "Trash2");
export const StoreIcon = styled(Store, "Store");
export const TagIcon = styled(Tag, "Tag");
export const ImageIcon = styled(ImageLucide, "Image");
export const PackageIcon = styled(Package, "Package");
export const ClockIcon = styled(Clock, "Clock");

/**
 * Katara brand mark — the four-element pinwheel (water drop + leaves),
 * drawn inline so it doesn't depend on the raster asset when a monochrome
 * currentColor glyph is needed (favicons, dense chrome). The full-colour
 * logo lives in <KataraLogo />.
 */
export const VitaLogoMark = ({ size = 20, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) => (
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
