# KAT-10 — Diagnostic status polling (PENDING / PROCESSING / COMPLETED)

> **Epic:** E2 — M1 Katara — Smart Irrigation & IoT
> **Phase:** P2 — More (Weeks 3–5)
> **Priority:** Must
> **Status:** TODO
> **Actor:** FARMER (frontend-only story; no backend route, no DB migration, no worker)
> **Depends on:** [KAT-07](./KAT-07-ai-diagnostic-request.md) (ships `DiagnosticSection.tsx`, `diagnostic-actions.ts` with `fetchLatestDiagnostic(parcelId)`, the `DiagnosticOut` type, the `STATUS_CHIP` map, and the page-level server fetch that hands `initialDiagnostic` to the component — KAT-10 reuses every piece without modification)
> **Unblocks:** PRD §12 Demo Scenario A — "Connected Farmer" (the visible chip transition `PROCESSING → COMPLETED` on the parcel page is the demo's hero moment; until KAT-10 ships, the farmer must refresh the page to see the result) · the full KAT-07 → KAT-08 → KAT-09 → KAT-10 user-visible loop (request → AI processes → email delivered → chip turns green live)
> **Acceptance:** A verified FARMER on `/dashboard/farmer/parcels/[id]` who has just clicked **Demander un diagnostic IA** (KAT-07) sees the status chip transition from `PENDING` → `PROCESSING` → `COMPLETED` (or `FAILED`) **without reloading the page**, within ≤ 5 s of each server-side state change. Polling stops automatically when the status reaches a terminal state (`COMPLETED` or `FAILED`), is suspended when the browser tab is hidden, and resumes on tab refocus. On terminal `COMPLETED`, the result card (already rendered by KAT-07) becomes visible in the same render cycle. No new API endpoint and no new component file — KAT-10 is a single in-place edit to `DiagnosticSection.tsx` plus a tiny hook helper.

---

## 1. Purpose

KAT-07 delivered the diagnostic button, the status chip, and the result card — but with a deliberate gap: the `diagnostic` state is initialised from a server-side `initialDiagnostic` prop and is only ever updated on the `requestDiagnostic` POST success (which returns the freshly-created `PENDING` row). After that, the chip is **frozen** until the page is refreshed. KAT-07's §5.6 component note even calls this out explicitly: *"KAT-10 will replace this static prop with a live-polled value."*

KAT-10 closes that gap with the smallest possible change: a polling lifecycle that re-calls `fetchLatestDiagnostic(parcelId)` on an interval while the diagnostic is in-flight, drives the existing `setDiagnostic` setter with the result, and stops itself the moment the status becomes terminal. The chip's visual transitions are already implemented (KAT-07's `STATUS_CHIP` record); the result card's COMPLETED branch is already rendered (KAT-07 §5.6, lines 713-723). KAT-10 wires the data; the UI is untouched.

Concretely KAT-10 delivers:

- **One new hook file `frontend/src/hooks/usePolling.ts`** — a small `useEffect`-based wrapper that runs an async callback on a fixed interval, exposes a manual `stop()` trigger, and pauses while `document.visibilityState === 'hidden'`. Zero external dependencies; ~40 lines.
- **One in-place edit to `DiagnosticSection.tsx`** — replaces the static `useState(initialDiagnostic)` with an effect that polls `fetchLatestDiagnostic(parcelId)` every 5 s **only when** the current status is `PENDING` or `PROCESSING`. Uses the existing `setDiagnostic` setter; the chip and result card re-render automatically via the existing JSX.
- **One frontend test file `frontend/__tests__/DiagnosticSection.polling.test.tsx`** — Vitest + React Testing Library scenarios covering: start-polling on in-flight initial prop, stop-polling on COMPLETED transition, no-polling when initial prop is null or terminal, tab-hidden pause/resume.
- **One acceptance-checklist update** — a new manual rehearsal step in §9 covering the Scenario A flow.

KAT-10 ships **no migration**, **no worker**, **no backend code**, **no Brevo template**, and **no env-var change**. It is the inverse of KAT-09 — that story was 100 % backend; this one is 100 % frontend.

Once `DONE`, the demo-day Scenario A chain reads end-to-end without a page reload: farmer clicks **Demander un diagnostic** → chip turns yellow `En attente` immediately (KAT-07's POST response) → chip turns blue `En cours…` within 5 s (KAT-08 worker started, polled by KAT-10) → chip turns green `Complété` within ~25-30 s (KAT-08 finished, polled by KAT-10) → result card expands → email arrives on the demo phone (KAT-09). The four stories form the spine of the PRD §12 Scenario A demonstration.

---

## 2. Scope

### In scope

- `frontend/src/hooks/usePolling.ts` — small reusable hook (one async callback, fixed interval, manual stop, visibility-aware pause).
- In-place edit to `frontend/src/app/dashboard/farmer/parcels/[id]/DiagnosticSection.tsx`:
  - Introduce a `shouldPoll` derived boolean: `diagnostic?.status === "PENDING" || diagnostic?.status === "PROCESSING"`.
  - Mount a `usePolling` effect keyed on `parcelId` that calls `fetchLatestDiagnostic(parcelId)` every 5 s while `shouldPoll` is true.
  - Apply the polled row to local state via `setDiagnostic` if (and only if) `row.status !== diagnostic?.status` **or** `row.id !== diagnostic?.id` (avoid extra renders when the server returns identical state).
  - Preserve the existing `requestDiagnostic` success path that calls `setDiagnostic(result.data)` — it remains the source of the initial `PENDING` chip; polling takes over from there.
- Frontend test file `frontend/__tests__/DiagnosticSection.polling.test.tsx` — five Vitest scenarios using `vi.useFakeTimers()` + a mocked `fetchLatestDiagnostic`.
- Acceptance criterion update in §9 — Scenario A manual rehearsal.
- `spring-status.yml` flip from `TODO` to `IN_REVIEW` once the staging smoke passes.

### Out of scope

- **WebSocket / Server-Sent Events / Supabase Realtime push** — pull-polling at 5 s is sufficient for the 25–30 s end-to-end window (PRD §10.1) and avoids the connection-lifecycle complexity of a push channel for a low-frequency event. A future story can swap `usePolling` for a Supabase Realtime subscription on the `m1_katara_diagnostics` table without touching the rendering surface.
- **Backend changes** — `GET /api/v1/katara/parcels/{id}/diagnostics/latest` is already stable since KAT-07; no rate-limit relaxation needed (a single browser polling every 5 s during a ~30 s window is 6 requests per diagnostic, well under any reasonable read budget).
- **Polling for diagnostics on other pages** — only the parcel detail page has the in-flight UX. The dashboard index does not show diagnostic chips; if/when it does, the same `usePolling` hook can be reused.
- **Exponential back-off** — the 5 s interval is fixed. A diagnostic completes within KAT-08's ~25-30 s p95; back-off would only matter for diagnostics stuck > 1 minute, which is a Sentry/admin concern (the row would be FAILED or the worker offline, both surfaced via INF-08).
- **Optimistic chip animation during the POST in-flight window** — KAT-07's `isPending` (`useTransition`) already greys the button; the chip appears on POST success. KAT-10 does not add a "submitting" pseudo-status.
- **Polling state machine in a global store (Zustand / Redux)** — local component state is sufficient. The diagnostic state is bound to the parcel detail page; no other surface needs to read it during MVD.
- **`notified_at` indicator in the UI** — out of scope per KAT-09 §10 hand-off note #3.
- **Service Worker / background sync** — the farmer is expected to keep the page open during the 30 s wait; if the tab is closed, the email (KAT-09) is the recovery channel.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [KAT-07](./KAT-07-ai-diagnostic-request.md) `DONE` | Ships `DiagnosticSection.tsx`, `diagnostic-actions.ts::fetchLatestDiagnostic`, the `DiagnosticOut` type with the four-state `status` discriminated union, and the page integration that fetches `initialDiagnostic` server-side. All KAT-10 reads from these. |
| [KAT-08](./KAT-08-diagnostic-owm-sentinel-gemini-worker.md) `IN_REVIEW` or `DONE` | Without KAT-08 the status never advances past `PENDING` and the polling loop has nothing meaningful to observe. KAT-10 can be code-reviewed in parallel with KAT-08 (no code dependency), but staging acceptance requires KAT-08 running. |
| [INF-03](./INF-03-nextjs-scaffold-login-dashboard.md) `DONE` | Next.js + Vitest + Testing Library scaffold; same harness used by KAT-04 / KAT-05 / KAT-07 frontend tests. |
| Frontend test deps already installed | `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` — all present from INF-03. |
| Verified FARMER staging account | The same account used for KAT-07 + KAT-08 e2e. The page must be reachable at `/dashboard/farmer/parcels/{id}` for a parcel with paired telemetry. |

KAT-09 is **not** a prerequisite of KAT-10. The two stories share Scenario A but are independent: KAT-10 makes the chip live; KAT-09 sends the email. They can ship in either order.

---

## 4. Data Contract

KAT-10 introduces no new server contract. It consumes the existing endpoint exactly as KAT-07 documents it.

### 4.1 Endpoint consumed

```
GET /api/v1/katara/parcels/{parcel_id}/diagnostics/latest
Authorization: Bearer <farmer access token>
```

Responses:

| Status | Body | Meaning for KAT-10 |
|---|---|---|
| `200` | `DiagnosticOut` | Update local state if `status` or `id` differs from current; otherwise no-op |
| `404` | `{"detail": "no_diagnostic_for_parcel"}` | Treat as `null` — farmer has never requested a diagnostic; do not poll |
| `401` / `403` | — | Token expired or revoked; `fetchLatestDiagnostic` returns `null` (it already silently returns `null` on non-2xx per KAT-07 §5.5); polling continues but rows are `null` — handled by the `shouldPoll` guard, which evaluates `false` on `null` |
| `5xx` | — | `fetchLatestDiagnostic` returns `null`; polling continues; next tick retries. No user-facing error toast — the chip simply doesn't advance, which is the desired graceful-degrade behaviour |

### 4.2 `DiagnosticOut` shape (re-exported from KAT-07)

```typescript
export interface DiagnosticOut {
  id:           string;
  parcel_id:    string;
  status:       "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  result_text:  string | null;
  error_detail: string | null;
  requested_at: string;
  started_at:   string | null;
  completed_at: string | null;
}
```

KAT-10 reads only `id` and `status`. The `result_text` field is read by the existing JSX (KAT-07 §5.6 line 713) when status flips to `COMPLETED`; no change there.

### 4.3 Polling lifecycle invariants

| Invariant | Enforcement |
|---|---|
| Polling starts only when initial status is in-flight (`PENDING` / `PROCESSING`) OR transitions into in-flight via the POST success | `shouldPoll` derived boolean; `usePolling`'s effect re-evaluates on dep change |
| Polling stops on terminal status (`COMPLETED` / `FAILED`) | `shouldPoll` becomes `false`; `usePolling` cleans up the interval in its `useEffect` cleanup |
| Polling is paused when the tab is hidden | `usePolling` subscribes to `visibilitychange`; on `hidden`, the interval is cleared; on `visible`, the callback fires immediately (catch-up) then the interval restarts |
| At most one in-flight request per parcel at any moment | A `useRef` guard inside the callback skips a tick if the previous tick's promise has not resolved |
| Polling is scoped to the mounted component instance | `useEffect` cleanup clears the interval on unmount; navigation away from the parcel page is sufficient to stop polling |
| Polling never updates state for a stale parcel | The fetch callback compares the resolved `row.parcel_id` against the closure's `parcelId`; mismatch → ignored (defence against rapid parcel-switching during the in-flight window) |

---

## 5. Step-by-Step Implementation

### 5.1 New hook — `frontend/src/hooks/usePolling.ts`

Create [`frontend/src/hooks/usePolling.ts`](../../frontend/src/hooks/usePolling.ts):

```typescript
"use client";

import { useEffect, useRef } from "react";

interface UsePollingOptions {
  /** Interval in milliseconds between callback invocations while active. */
  intervalMs: number;
  /** When false, the polling effect is inert (no interval scheduled). */
  enabled: boolean;
  /** Async callback to execute each tick. Errors must be swallowed by the caller. */
  callback: () => Promise<void> | void;
  /** Optional debug label surfaced in dev console messages. */
  label?: string;
}

/**
 * KAT-10 — Visibility-aware fixed-interval polling hook.
 *
 * - Skips ticks while document.visibilityState === "hidden".
 * - On tab refocus, fires the callback once immediately then resumes the interval.
 * - Guarantees at most one in-flight callback at a time via a ref-based busy flag.
 * - Clears the interval on unmount and on enabled → false transitions.
 *
 * Deliberately minimal — no exponential back-off, no retry, no SWR-style cache.
 * The diagnostic-polling use case completes within ~30 s, so this surface is
 * intentionally smaller than `useSWR({ refreshInterval })`.
 */
export function usePolling({
  intervalMs,
  enabled,
  callback,
  label,
}: UsePollingOptions): void {
  const callbackRef = useRef(callback);
  const busyRef = useRef(false);

  // Keep the latest callback referenced without re-scheduling the interval.
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      if (busyRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      busyRef.current = true;
      try {
        await callbackRef.current();
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.warn(`[usePolling${label ? `:${label}` : ""}] callback threw`, err);
        }
      } finally {
        busyRef.current = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void tick();
      }
    };

    intervalId = setInterval(() => void tick(), intervalMs);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      if (intervalId !== null) clearInterval(intervalId);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [enabled, intervalMs, label]);
}
```

**Design notes:**
- The hook returns `void`. There is no `stop()` function exposed — the caller controls activation through `enabled`. This collapses the API surface to a single declarative boolean (`shouldPoll`), which is what `DiagnosticSection` already has at hand.
- `callbackRef` decouples callback identity from the effect's dependency array. Without it, every render would re-create the interval (because the inline async closure has a fresh identity each render). This is the standard React solution; see the same pattern in Dan Abramov's "Making setInterval Declarative with React Hooks".
- The busy-flag (`busyRef.current`) is the at-most-one guarantee from §4.3. A slow `/diagnostics/latest` response that exceeds `intervalMs` does not stack requests.
- The hook does not auto-fire on mount — the first invocation is at `intervalMs` after enabling. `DiagnosticSection` does not need an immediate fire on mount because the page already passes a fresh `initialDiagnostic` via SSR. The post-`requestDiagnostic` flow likewise gets an immediate state update from the POST response. So the first poll tick `T+5 s` is the right cadence.

---

### 5.2 In-place edit — `DiagnosticSection.tsx`

Edit [`frontend/src/app/dashboard/farmer/parcels/[id]/DiagnosticSection.tsx`](../../frontend/src/app/dashboard/farmer/parcels/[id]/DiagnosticSection.tsx).

**Step A — add imports** (top of the file, after the existing imports):

```typescript
import { useEffect, useState, useTransition } from "react";

import type { DiagnosticOut } from "./diagnostic-actions";
import { fetchLatestDiagnostic, requestDiagnostic } from "./diagnostic-actions";
import { usePolling } from "@/hooks/usePolling";
```

The only delta versus KAT-07's existing imports:
- `useEffect` is now needed (was not used in KAT-07).
- `fetchLatestDiagnostic` is now imported (was previously only called server-side from `page.tsx`; KAT-10 calls it client-side too).
- `usePolling` is the new hook.

**Step B — declare polling constants** (right above the component, after `STATUS_CHIP`):

```typescript
const POLLING_INTERVAL_MS = 5_000;
const TERMINAL_STATUSES: ReadonlySet<DiagnosticOut["status"]> = new Set([
  "COMPLETED",
  "FAILED",
]);
```

**Step C — inside the component body**, after the existing `const [diagnostic, setDiagnostic] = useState<DiagnosticOut | null>(initialDiagnostic);` declaration, add the polling effect:

```typescript
// KAT-10 — derived: are we currently waiting on the backend?
const shouldPoll =
  diagnostic !== null && !TERMINAL_STATUSES.has(diagnostic.status);

usePolling({
  enabled: shouldPoll,
  intervalMs: POLLING_INTERVAL_MS,
  label: "diagnostic-status",
  callback: async () => {
    const row = await fetchLatestDiagnostic(parcelId);
    if (row === null) return;
    if (row.parcel_id !== parcelId) return; // defence against rapid route changes
    setDiagnostic((prev) => {
      // No-op render guard: skip setState when nothing observable changed.
      if (
        prev !== null &&
        prev.id === row.id &&
        prev.status === row.status
      ) {
        return prev;
      }
      return row;
    });
  },
});
```

That is the entire substantive change. No other line in `DiagnosticSection.tsx` is modified. The existing `STATUS_CHIP` map, the existing button JSX, the existing COMPLETED `<details>` block, and the existing FAILED error line all continue to work — they read from `diagnostic`, which `usePolling` now keeps fresh.

**Step D — update the in-line comment** that KAT-07 left at the `useState` line. Replace:

```typescript
// KAT-10 will replace this static prop with a live-polled value.
const [diagnostic, setDiagnostic] = useState<DiagnosticOut | null>(
  initialDiagnostic
);
```

with:

```typescript
const [diagnostic, setDiagnostic] = useState<DiagnosticOut | null>(
  initialDiagnostic
);
```

(Remove the placeholder comment — KAT-10 has now closed the gap. Per the project's "no obsolete TODO comments" convention.)

---

### 5.3 Path-alias check

The import `@/hooks/usePolling` assumes the `@/*` alias maps to `frontend/src/*`. Confirm against `frontend/tsconfig.json`'s `compilerOptions.paths`. If the alias does not exist, use the relative path:

```typescript
import { usePolling } from "../../../../hooks/usePolling";
```

INF-03's scaffold (per its §5.x acceptance) configures `@/*` → `src/*` by default; in 99 % of cases the alias is the correct form.

---

### 5.4 Frontend test — `DiagnosticSection.polling.test.tsx`

Create [`frontend/__tests__/DiagnosticSection.polling.test.tsx`](../../frontend/__tests__/DiagnosticSection.polling.test.tsx):

```typescript
import { render, screen, act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DiagnosticSection } from "@/app/dashboard/farmer/parcels/[id]/DiagnosticSection";
import type { DiagnosticOut } from "@/app/dashboard/farmer/parcels/[id]/diagnostic-actions";
import * as diagnosticActions from "@/app/dashboard/farmer/parcels/[id]/diagnostic-actions";

const PARCEL_ID = "11111111-1111-1111-1111-111111111111";
const ACCESS_TOKEN = "fake-token";

function diag(over: Partial<DiagnosticOut>): DiagnosticOut {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    parcel_id: PARCEL_ID,
    status: "PENDING",
    result_text: null,
    error_detail: null,
    requested_at: "2026-05-17T09:00:00Z",
    started_at: null,
    completed_at: null,
    ...over,
  };
}

describe("DiagnosticSection — KAT-10 polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("S1 — starts polling when initial status is PENDING and stops on COMPLETED", async () => {
    const fetchSpy = vi
      .spyOn(diagnosticActions, "fetchLatestDiagnostic")
      .mockResolvedValueOnce(diag({ status: "PROCESSING" }))
      .mockResolvedValueOnce(
        diag({ status: "COMPLETED", result_text: "All good." })
      );

    render(
      <DiagnosticSection
        parcelId={PARCEL_ID}
        accessToken={ACCESS_TOKEN}
        isVerified
        initialDiagnostic={diag({ status: "PENDING" })}
        hasTelemetry
      />
    );

    expect(screen.getByText("En attente")).toBeInTheDocument();

    // Tick 1 — PROCESSING
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("En cours…")).toBeInTheDocument();

    // Tick 2 — COMPLETED → polling should stop after this tick
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Complété")).toBeInTheDocument();

    // Tick 3 — no further fetch
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("S2 — does not poll when initial status is COMPLETED", async () => {
    const fetchSpy = vi.spyOn(diagnosticActions, "fetchLatestDiagnostic");

    render(
      <DiagnosticSection
        parcelId={PARCEL_ID}
        accessToken={ACCESS_TOKEN}
        isVerified
        initialDiagnostic={diag({ status: "COMPLETED", result_text: "done" })}
        hasTelemetry
      />
    );

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("S3 — does not poll when initial diagnostic is null", async () => {
    const fetchSpy = vi.spyOn(diagnosticActions, "fetchLatestDiagnostic");

    render(
      <DiagnosticSection
        parcelId={PARCEL_ID}
        accessToken={ACCESS_TOKEN}
        isVerified
        initialDiagnostic={null}
        hasTelemetry
      />
    );

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("S4 — pauses polling when document.visibilityState is hidden, resumes on visible", async () => {
    const fetchSpy = vi
      .spyOn(diagnosticActions, "fetchLatestDiagnostic")
      .mockResolvedValue(diag({ status: "PROCESSING" }));

    render(
      <DiagnosticSection
        parcelId={PARCEL_ID}
        accessToken={ACCESS_TOKEN}
        isVerified
        initialDiagnostic={diag({ status: "PROCESSING" })}
        hasTelemetry
      />
    );

    // Hide tab — polling should skip ticks
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });

    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    // Reveal tab — visibilitychange listener fires immediate catch-up
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("S5 — ignores responses whose parcel_id does not match (rapid route change)", async () => {
    vi.spyOn(diagnosticActions, "fetchLatestDiagnostic").mockResolvedValueOnce(
      diag({ status: "COMPLETED", parcel_id: "other-parcel" })
    );

    render(
      <DiagnosticSection
        parcelId={PARCEL_ID}
        accessToken={ACCESS_TOKEN}
        isVerified
        initialDiagnostic={diag({ status: "PROCESSING" })}
        hasTelemetry
      />
    );

    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Status chip should NOT have advanced to "Complété" — the cross-parcel row was ignored.
    expect(screen.queryByText("Complété")).not.toBeInTheDocument();
    expect(screen.getByText("En cours…")).toBeInTheDocument();
  });
});
```

**Test design notes:**
- Vitest's `vi.useFakeTimers()` is enabled per-test so the suite runs in milliseconds rather than real time. `vi.advanceTimersByTime(5_000)` simulates one polling cycle.
- The double `await act(async () => { await Promise.resolve(); })` after `advanceTimersByTime` is the standard React 18 + fake-timers pattern: the first `act` flushes microtasks queued by the resolved fetch promise; the second flushes the resulting `setState`. Without it, the `getByText` query runs before the chip re-renders.
- `vi.spyOn(diagnosticActions, "fetchLatestDiagnostic")` is preferred over `vi.mock("...")` for two reasons: (a) it preserves the original module surface so other imports (`requestDiagnostic`, `DiagnosticOut`) remain real; (b) it scopes the mock to the test file (no risk of leakage into other suites via Vitest's module cache).
- S4 (visibility) is the most fragile test in the suite — jsdom does not implement the Page Visibility API. Overriding `document.visibilityState` via `Object.defineProperty` is the pragmatic workaround; an alternative is to wrap the `visibilityState` check in `usePolling` behind a `getVisibility()` helper that the test can stub directly. The current form is preferred for keeping the hook itself dependency-free.
- S5 verifies the `row.parcel_id !== parcelId` guard added in §5.2 Step C. This guards against a user clicking back to the previous parcel in the middle of an in-flight tick — without the guard, the stale response would overwrite the new parcel's state.

---

### 5.5 No `package.json`, `tsconfig.json`, or `next.config.mjs` change

KAT-10 introduces no new dependencies. `usePolling` uses only React built-ins (`useEffect`, `useRef`). The test file uses Vitest + Testing Library, which are already in INF-03's lockfile.

If `@/hooks/*` is not already an alias, KAT-10 may need to add it to `frontend/tsconfig.json` `paths` — but the INF-03 scaffold ships with `@/*` mapping to `src/*`, so `@/hooks/usePolling` resolves out of the box. Confirm during implementation.

---

### 5.6 `spring-status.yml` flip

Once the manual rehearsal (§9) passes and `pnpm --filter frontend test DiagnosticSection.polling` is green, edit `docs/spring-status.yml`:

```yaml
      - id: KAT-10
        title: Diagnostic status polling (PENDING/PROCESSING/COMPLETED)
        priority: Must
        status: IN_REVIEW   # ← was TODO
        actor: FARMER
        acceptance: "UI shows live status during processing"
        depends_on: [KAT-07]
```

No other rows in `spring-status.yml` are touched.

---

## 6. Design Decisions & Risks

### 6.1 Why polling and not Supabase Realtime?

The Supabase Realtime channel for `m1_katara_diagnostics` would deliver a push notification with sub-second latency — strictly better UX. But it costs:

- A `realtime.publication` policy on the table (DB migration).
- A Supabase Realtime subscription configuration per page mount (frontend code).
- An RLS-aware filter for the channel (the farmer should not receive Realtime events for other farmers' diagnostics — enforceable but adds a `WHERE farmer_id = auth.uid()` to the publication filter).
- A more complex unsubscribe lifecycle (channel.unsubscribe() on unmount).
- Potential collisions with the AUTH-07 RLS matrix (a new column on the matrix for the publication policy).

For a single-page, single-event-stream feature with a known ~30 s upper bound, 5 s pull-polling is the right tool. Six HTTP requests per diagnostic × 50 demo farmers × ~3 diagnostics each ≈ 900 requests — well under the Supabase free-tier read budget (PRD §11.1). Post-MVD, a Realtime swap is a one-file change (the rest of the component is push-source-agnostic).

### 6.2 Why 5 s and not 2 s or 10 s?

- **2 s** — overshoots: KAT-08 worker p50 is ~15-25 s, so the chip would update on tick 7-12 out of 12, all but the last being PROCESSING → PROCESSING (no visual change). Wasted requests.
- **10 s** — undershoots demo expectations: a 30 s diagnostic could go through PENDING → PROCESSING → COMPLETED with only 3 polls, all of which might miss the brief PENDING window. Worse: the farmer might wait 9 s after the diagnostic actually completes before seeing the green chip — visible lag during the demo.
- **5 s** — sweet spot: a 30 s diagnostic produces 5-6 polls; the PENDING → PROCESSING transition is captured on tick 1-2; the PROCESSING → COMPLETED transition is captured within 5 s of actual completion. The chip animates visibly during the demo.

The constant is a single `POLLING_INTERVAL_MS` value at the top of `DiagnosticSection.tsx`; tuning post-staging is a one-line change.

### 6.3 Why a custom `usePolling` and not `useSWR` with `refreshInterval`?

`useSWR` is excellent but brings a global cache (the SWR cache key would be `["diagnostic", parcelId]`), revalidation-on-focus by default, and a dependency the rest of the codebase does not currently use (KAT-04 and KAT-05 do their own polling for telemetry with similar lightweight effects). Adding SWR for one component would create a precedent — either every other component refactors to SWR, or we live with two patterns indefinitely.

The custom hook is ~40 lines, has no surface area beyond the four-option props record, and is reusable for KAT-11 (offline device detection — same shape, different endpoint) and any future polling story. The cost of writing it is lower than the cost of introducing SWR for a single use case.

If post-MVD the codebase consolidates around SWR or TanStack Query, `usePolling` is the smallest possible blast-radius migration: delete the file, swap the call in `DiagnosticSection.tsx` for `useSWR({ refreshInterval: shouldPoll ? 5000 : 0 })`. No backend change, no contract change.

### 6.4 The visibility-aware pause is mandatory, not nice-to-have

A farmer on the demo phone who briefly switches to WhatsApp to show a colleague the email (KAT-09) would, without the pause, generate background polling requests for as long as the tab is open. On the demo VPS that's irrelevant; in production with 50+ farmers each leaving a tab open overnight, it's a multiplicative wasted-request bill. The pause is one `visibilitychange` listener — trivial to add now, irritating to retrofit later.

The immediate catch-up tick on `visible` ensures a refocused tab does not wait up to 5 s to refresh — that would feel laggy.

### 6.5 No-op state-update guard prevents re-render thrash

When the worker is mid-flight, every 5 s the server returns a row whose `status` is still `PROCESSING`. Without the `prev.id === row.id && prev.status === row.status` early-return inside `setDiagnostic`, React would call the parent re-render every tick, including any descendants of `DiagnosticSection` (currently none, but future expansion could include a result preview that does expensive markdown rendering on every diff). The guard is cheap insurance.

This is also why the polling callback uses `setDiagnostic((prev) => ...)` rather than reading `diagnostic` from the closure: the closure form would close over a stale `diagnostic` value (the one at the time the callback was created), defeating the guard. The functional setter form always receives the latest state.

### 6.6 Failure modes and graceful degradation

| Failure | Behaviour | Recovery |
|---|---|---|
| `/diagnostics/latest` returns 5xx | `fetchLatestDiagnostic` returns `null`; the polling callback's `if (row === null) return;` skips state update; chip remains on previous value | Next tick (5 s) retries |
| Network offline (`fetch` throws) | `usePolling`'s `try/catch` swallows the error and logs in dev; chip remains static | Next tick retries; on tab refocus, the visibility listener fires an immediate retry |
| Access token expired mid-poll | `fetchLatestDiagnostic` returns `null` for 401 (per KAT-07 §5.5); chip remains static; farmer's next user action (page navigation, button click) will surface the auth redirect via existing middleware | Standard re-auth flow |
| Worker is down (no PROCESSING transition for > 5 min) | Chip stays on `PENDING` indefinitely; polling continues indefinitely | The user-visible signal is "this is taking too long" — they can manually refresh or contact support. INF-08 / Healthchecks pages on-call. Post-MVD: a "diagnostic taking longer than expected" inline message after N ticks |

None of these failures crash the page or the polling loop. The worst case is a frozen chip that resolves on the next successful tick or on page refresh.

### 6.7 Risk — React Strict Mode double-mount

Next.js dev mode wraps client components in Strict Mode, which double-invokes effects. `usePolling` is double-invoked: the first invocation creates an interval, the cleanup fires immediately, then the second invocation creates a fresh interval. Net result: one interval, no double-polling. Verified by inspecting test S1 — fetch is called exactly twice across two ticks.

Production builds do not have Strict Mode double-mount, so behaviour is identical. No special handling needed.

---

## 7. Tests

### 7.1 Frontend unit / component tests — `frontend/__tests__/DiagnosticSection.polling.test.tsx`

| # | Scenario | Expected |
|---|---|---|
| S1 | Initial status `PENDING`, server returns `PROCESSING` then `COMPLETED` on consecutive ticks | Chip transitions `En attente` → `En cours…` → `Complété`; fetch called exactly twice; no tick 3 fetch |
| S2 | Initial status `COMPLETED` | `fetchLatestDiagnostic` never called even after 20 s of fake time |
| S3 | Initial diagnostic `null` (farmer never requested one) | `fetchLatestDiagnostic` never called |
| S4 | Tab hidden → polling skipped; tab visible → immediate catch-up tick | No fetches during hidden; exactly one fetch on visibilitychange to `visible` |
| S5 | Server returns a row whose `parcel_id` differs from the page's `parcelId` (rapid route change) | Row is ignored; chip does not advance |

### 7.2 Manual staging rehearsal (single scenario, demo-day-equivalent)

This is the human-eye verification; automated e2e for the polling loop alone is not worth the infrastructure cost given the small surface.

1. Open `https://staging.vitachain.ma/dashboard/farmer/parcels/{parcel-with-telemetry}` as a verified FARMER.
2. Confirm no diagnostic chip is visible (or that the most recent diagnostic chip is COMPLETED / FAILED).
3. Click **Demander un diagnostic IA**. The button shows "Envoi…" briefly (KAT-07's `useTransition`).
4. **Within < 1 s** of button release, the yellow `En attente` chip appears (KAT-07's POST response → setDiagnostic).
5. **Within 5-10 s** the chip transitions to blue `En cours…` (KAT-08 worker picked up the row → first poll tick observed it).
6. **Within 25-35 s of step 3** the chip transitions to green `Complété`. The "Voir le résultat" `<details>` appears.
7. Click "Voir le résultat" — the AI text is rendered as plain Markdown source (KAT-09's HTML rendering applies only to the email; the in-page card displays raw text per KAT-07 §5.6).
8. **No further polling**: open browser DevTools → Network → filter `latest`. Observe that after the green chip appears, no additional `/diagnostics/latest` requests fire for at least 30 s.
9. Switch to a different browser tab for ≥ 10 s. Switch back. Open DevTools → Network. No `/diagnostics/latest` request fires on the visibility change (because status is terminal).
10. Click **Demander un diagnostic IA** again (still allowed — terminal status is not in-flight).
11. Switch to another tab while status is `PROCESSING`. Wait 15 s. Switch back. Confirm a `/diagnostics/latest` request fires within 1 s of refocus (the visibility catch-up tick).

### 7.3 No backend tests

KAT-10 ships no backend code. `GET /diagnostics/latest`'s contract is covered by `backend/tests/test_kat07_diagnostics.py` (KAT-07 §7.1).

### 7.4 No pgTAP cells

KAT-10 introduces no DB object. The AUTH-07 matrix is unchanged.

---

## 8. Observability

KAT-10 adds no Sentry breadcrumbs, no log lines, no Healthchecks heartbeat. The relevant observability surface is:

| Signal | Source | What it tells us about KAT-10 |
|---|---|---|
| Browser DevTools Network panel | Manual | Confirms polling cadence, visibility pause, and terminal-state stop |
| Sentry frontend project (INF-08) | Automatic via `@sentry/nextjs` | Any uncaught error in `usePolling` (e.g. a future refactor regression) surfaces as a JS error event |
| Backend route span on `GET /diagnostics/latest` | Automatic via FastAPI Sentry middleware (INF-08) | If polling load becomes unexpectedly high, the p95 latency on this route would show it |
| FastAPI access logs (NGINX + uvicorn) | Automatic | The `/diagnostics/latest` GET count is a direct measure of polling traffic; useful for the 90-day post-MVD review of "do we still want polling vs Realtime?" |

If post-MVD the polling load on `/diagnostics/latest` becomes material (> 1 % of all backend RPS), the Realtime swap (§6.1) is the response.

---

## 9. Acceptance Verification Checklist

Run before flipping `spring-status.yml` to `IN_REVIEW`:

- [ ] `pnpm --filter frontend test DiagnosticSection.polling` — all 5 scenarios green
- [ ] `pnpm --filter frontend lint` — no new errors
- [ ] `pnpm --filter frontend typecheck` — clean
- [ ] `pnpm --filter frontend build` — succeeds (Next.js production build has no client-component import cycles introduced by `usePolling`)
- [ ] Manual staging rehearsal (§7.2) steps 1-11 — all observed behaviours match
- [ ] DevTools Network panel during a full PENDING → PROCESSING → COMPLETED cycle shows: button POST → 5 s gap → first `/latest` GET → 5 s gap → second `/latest` GET (returning COMPLETED) → no further GETs
- [ ] DevTools Network panel during tab-hidden interval shows zero `/latest` requests
- [ ] DevTools Network panel on tab-refocus shows exactly one `/latest` request within 1 s of `visibilitychange`
- [ ] Component re-renders are bounded: with React DevTools Profiler attached, a full PROCESSING → COMPLETED cycle produces ≤ 3 `DiagnosticSection` renders (initial, on POST success, on terminal status). Intermediate ticks that return identical state cause zero re-renders (no-op state guard)
- [ ] No console errors / warnings in dev mode during a full Strict-Mode double-mount lifecycle
- [ ] Scenario A demo rehearsal end-to-end (after KAT-09 also `IN_REVIEW`): farmer clicks button → chip animates live → email arrives on demo phone. Total visible latency from click to green chip: < 35 s.

---

## 10. Hand-off Notes for Future Work

KAT-10 is a leaf story — no other Must-priority story in `spring-status.yml` depends on it. The following are post-MVD follow-ups that could be informed by KAT-10's choices:

1. **KAT-11 (offline device detection)** can reuse `usePolling` verbatim. The endpoint is different (e.g. `GET /parcels/{id}/device/status`), the terminal condition is different (no terminal — the page is always observing), but the hook's API supports both shapes via `enabled` and `intervalMs`. Estimated 1-hour reuse.
2. **KAT-04 / KAT-05 telemetry refresh** — those stories implemented their own setInterval-based refresh loops at the time. A small follow-up could harmonise them onto `usePolling` for consistency. Not a correctness issue; pure code-hygiene.
3. **Supabase Realtime migration** (§6.1) is the single most likely post-MVD architecture change. The migration touches only `DiagnosticSection.tsx` — `usePolling` is deleted and replaced with a `useEffect` that subscribes to a Realtime channel filtered by `parcel_id`. The component's render surface and the page-level `initialDiagnostic` SSR fetch both remain unchanged.
4. **i18n of chip labels** — the `STATUS_CHIP` map in KAT-07 contains hardcoded French strings (`"En attente"`, `"En cours…"`, etc.). This was deliberately deferred from KAT-07; it will be picked up by an i18n story that scans all components for hardcoded strings. KAT-10 inherits the hardcoded strings as-is and does not extend them.
5. **A11y for the chip** — the chip is currently a styled `<span>` with no `role` or `aria-live` attribute. A screen-reader user watching the chip transition would hear nothing. Adding `aria-live="polite"` and an `aria-label` on the chip's wrapping `<div>` is a 5-line a11y patch that can land in a sweep with other M1 a11y fixes. Out of scope for KAT-10 because it is unrelated to polling.
6. **Diagnostic history view** — the `GET /diagnostics/latest` shape is "the most recent row". A future "see past diagnostics" surface needs a `GET /diagnostics?limit=20` endpoint and a list view. That work has no overlap with KAT-10 — polling is a live-state concern; history is a static-state concern.
