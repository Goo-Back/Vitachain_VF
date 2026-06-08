import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function buildMapSearchUrl(
  query: { lat: number; lng: number } | string,
  language: 'en' | 'ar' = 'en'
): string {
  const params = `&hl=${language}&gl=ma`;
  if (typeof query === 'string') {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}${params}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${query.lat},${query.lng}${params}`;
}

export function buildMapEmbedUrl(lat: number | string, lng: number | string, language: 'en' | 'ar' = 'en'): string {
  return `https://maps.google.com/maps?q=${lat},${lng}&z=15&output=embed&hl=${language}&gl=ma`;
}

export function buildMapLink(lat: number | string, lng: number | string, language: 'en' | 'ar' = 'en'): string {
  return `https://www.google.com/maps?q=${lat},${lng}&hl=${language}&gl=ma`;
}
