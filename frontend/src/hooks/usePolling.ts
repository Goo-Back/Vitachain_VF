"use client";

import { useEffect, useRef } from "react";

interface UsePollingOptions {
  intervalMs: number;
  enabled: boolean;
  callback: () => Promise<void> | void;
  label?: string;
}

/**
 * KAT-10 — Visibility-aware fixed-interval polling hook.
 *
 * Skips ticks while the tab is hidden, fires a catch-up tick on refocus,
 * and guarantees at most one in-flight callback at a time. Deliberately
 * minimal — no back-off, no retry, no cache.
 */
export function usePolling({
  intervalMs,
  enabled,
  callback,
  label,
}: UsePollingOptions): void {
  const callbackRef = useRef(callback);
  const busyRef = useRef(false);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      if (busyRef.current) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      busyRef.current = true;
      try {
        await callbackRef.current();
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            `[usePolling${label ? `:${label}` : ""}] callback threw`,
            err,
          );
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

    const intervalId = setInterval(() => void tick(), intervalMs);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [enabled, intervalMs, label]);
}
