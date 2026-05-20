/**
 * KAT-14 — light formatting helpers for the overview surface.
 *
 * Avoids a new `date-fns` dependency for what is two short FR strings.
 * The detail page uses toLocaleDateString directly; the overview wants
 * "il y a 12 min" granularity, hence the small relative formatter below.
 */

export function formatRelativeFr(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const delta = Math.max(0, now - then);
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return "à l'instant";
  const min = Math.floor(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `il y a ${hr} h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `il y a ${day} j`;
  // Beyond ~1 month the absolute date is more useful than "il y a 42 j".
  return new Date(iso).toLocaleDateString("fr-FR");
}
