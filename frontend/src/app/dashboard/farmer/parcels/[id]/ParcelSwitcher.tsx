"use client";

import { useRouter, useSearchParams } from "next/navigation";

import type { ParcelOverviewEntry } from "@/app/dashboard/farmer/overview-types";

/**
 * KAT-14 — persistent parcel pivoter mounted at the top of the parcel
 * detail page header. A compact pill list, keyboard-navigable, with a
 * breach dot on any parcel whose latest reading violates its thresholds.
 *
 * Query-param contract (KAT-14 §5.6):
 *   - PRESERVABLE_PARAMS → carried across the pivot (sub-tab state that is
 *                          parcel-agnostic, e.g. ?window=7d).
 *   - PARCEL_SCOPED_PARAMS → DROPPED on pivot because the value is a
 *                          parcel-specific UUID (e.g. ?device_id=...).
 *
 * Both sets are explicit allow-lists, not deny-lists — a future query
 * param added to the detail page is silently dropped on pivot unless it
 * is added to one of the sets. This is the safe default: a leaked
 * parcel-scoped UUID is a worse failure than a dropped sub-tab state.
 */

interface Props {
  currentParcelId: string;
  parcels: ParcelOverviewEntry[];
}

const PARCEL_SCOPED_PARAMS = new Set(["device_id"]);
const PRESERVABLE_PARAMS = new Set(["window"]);

export function ParcelSwitcher({ currentParcelId, parcels }: Props) {
  const router = useRouter();
  const search = useSearchParams();

  // Single-parcel farmer: rendering the switcher would just be noise.
  if (parcels.length <= 1) return null;

  function pivot(parcelId: string) {
    if (parcelId === currentParcelId) return;
    const next = new URLSearchParams();
    for (const [k, v] of search.entries()) {
      if (PARCEL_SCOPED_PARAMS.has(k)) continue; // drop
      if (!PRESERVABLE_PARAMS.has(k)) continue; // drop (unknown)
      next.set(k, v);
    }
    const qs = next.toString();
    router.push(
      `/dashboard/farmer/parcels/${parcelId}${qs ? `?${qs}` : ""}`,
    );
  }

  return (
    <nav
      aria-label="Naviguer entre mes parcelles"
      className="mb-4 -mx-1 overflow-x-auto"
    >
      <ul className="flex gap-2 px-1">
        {parcels.map((p) => {
          const active = p.parcel_id === currentParcelId;
          return (
            <li key={p.parcel_id} className="shrink-0">
              <button
                type="button"
                onClick={() => pivot(p.parcel_id)}
                aria-current={active ? "page" : undefined}
                title={p.name}
                className={
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-emerald-500 " +
                  (active
                    ? "border-emerald-600 bg-emerald-50 font-medium text-emerald-900"
                    : "border-neutral-200 bg-white text-neutral-700 hover:border-emerald-300 hover:bg-emerald-50")
                }
              >
                <span className="truncate max-w-[12rem]">{p.name}</span>
                {p.has_open_threshold_breach && (
                  <span
                    className="inline-block h-2 w-2 rounded-full bg-amber-500"
                    aria-label="Seuil dépassé"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
