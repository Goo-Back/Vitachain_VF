"use client";

/**
 * Landing-page motion primitives.
 *
 * Hand-ported from Magic UI (magicui.design) and React Bits
 * (reactbits.dev) so they sit on our own design tokens instead of
 * pulling a component registry. Built on `motion` + a few keyframes
 * declared in globals.css. Everything here is client-only.
 */

import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useTransform,
  type Variants,
} from "motion/react";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* BlurFade — Magic UI. Reveals children with a blur + rise on enter.  */
/* ------------------------------------------------------------------ */

export function BlurFade({
  children,
  className,
  delay = 0,
  duration = 0.5,
  yOffset = 16,
  blur = "8px",
  once = true,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  duration?: number;
  yOffset?: number;
  blur?: string;
  once?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once, margin: "-60px" });

  const variants: Variants = {
    hidden: { opacity: 0, y: yOffset, filter: `blur(${blur})` },
    visible: { opacity: 1, y: 0, filter: "blur(0px)" },
  };

  return (
    <motion.div
      ref={ref}
      initial="hidden"
      animate={inView ? "visible" : "hidden"}
      variants={variants}
      transition={{ delay, duration, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* AnimatedGradientText — Magic UI. Sweeping multi-stop gradient text. */
/* ------------------------------------------------------------------ */

export function AnimatedGradientText({
  children,
  className = "",
  from = "var(--color-leaf-600)",
  via = "var(--color-sky-tint-500)",
  to = "var(--color-leaf-600)",
}: {
  children: ReactNode;
  className?: string;
  from?: string;
  via?: string;
  to?: string;
}) {
  return (
    <span
      className={`vc-gradient-text ${className}`}
      style={{
        backgroundImage: `linear-gradient(90deg, ${from}, ${via}, ${to})`,
      }}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* ShimmerButton — Magic UI. A travelling highlight on a solid button. */
/* ------------------------------------------------------------------ */

export function ShimmerButton({
  children,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`vc-shimmer group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-br from-leaf-500 to-leaf-700 px-6 py-3 text-sm font-semibold text-white shadow-[0_4px_18px_-4px_oklch(0.55_0.14_152/0.5)] transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0 ${className}`}
      {...rest}
    >
      <span className="relative z-10 inline-flex items-center gap-2">
        {children}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Marquee — Magic UI. Seamless infinite scroller (h / v).             */
/* ------------------------------------------------------------------ */

export function Marquee({
  children,
  className = "",
  reverse = false,
  pauseOnHover = true,
  duration = "32s",
  gap = "1.5rem",
}: {
  children: ReactNode;
  className?: string;
  reverse?: boolean;
  pauseOnHover?: boolean;
  duration?: string;
  gap?: string;
}) {
  const track = reverse ? "animate-marquee-reverse" : "animate-marquee";
  return (
    <div
      className={`group flex w-full overflow-hidden ${className}`}
      style={{ ["--duration" as string]: duration, ["--gap" as string]: gap }}
    >
      {[0, 1].map((i) => (
        <div
          key={i}
          aria-hidden={i === 1}
          className={`flex shrink-0 ${track} ${pauseOnHover ? "group-hover:[animation-play-state:paused]" : ""}`}
          style={{ gap, paddingRight: gap }}
        >
          {children}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* BorderBeam — Magic UI. A light dot orbiting a rounded border.       */
/* ------------------------------------------------------------------ */

export function BorderBeam({
  size = 64,
  duration = 8,
  delay = 0,
  from = "var(--color-leaf-400)",
  to = "var(--color-sky-tint-500)",
}: {
  size?: number;
  duration?: number;
  delay?: number;
  from?: string;
  to?: string;
}) {
  return (
    <div
      className="vc-border-beam"
      style={
        {
          "--beam-size": `${size}px`,
          "--beam-duration": `${duration}s`,
          "--beam-delay": `${delay}s`,
          "--beam-from": from,
          "--beam-to": to,
        } as CSSProperties
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* ShineBorder — Magic UI. A glowing gradient arc rotates around the    */
/* element's border (alternative to the orbiting-dot BorderBeam).       */
/* ------------------------------------------------------------------ */

export function ShineBorder({
  duration = 6,
  width = 1.5,
  delay = 0,
  from = "var(--color-leaf-400)",
  to = "var(--color-sky-tint-500)",
}: {
  duration?: number;
  width?: number;
  delay?: number;
  from?: string;
  to?: string;
}) {
  return (
    <div
      className="vc-shine"
      style={
        {
          "--shine-duration": `${duration}s`,
          "--shine-width": `${width}px`,
          "--shine-from": from,
          "--shine-to": to,
          animationDelay: `${delay}s`,
        } as CSSProperties
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* NumberTicker — Magic UI. Counts up to `value` when scrolled into view.*/
/* ------------------------------------------------------------------ */

export function NumberTicker({
  value,
  decimals = 0,
  duration = 1.6,
  className = "",
  suffix = "",
  prefix = "",
}: {
  value: number;
  decimals?: number;
  duration?: number;
  className?: string;
  suffix?: string;
  prefix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) =>
    `${prefix}${v.toLocaleString("fr-FR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}${suffix}`,
  );

  useEffect(() => {
    if (!inView) return;
    const controls = animate(mv, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
    });
    return () => controls.stop();
  }, [inView, value, duration, mv]);

  return (
    <motion.span ref={ref} className={`tabular ${className}`}>
      {text}
    </motion.span>
  );
}

/* ------------------------------------------------------------------ */
/* GridPattern — Magic UI. SVG grid for section backdrops.             */
/* ------------------------------------------------------------------ */

export function GridPattern({
  size = 40,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const id = `grid-${size}`;
  return (
    <svg
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    >
      <defs>
        <pattern id={id} width={size} height={size} patternUnits="userSpaceOnUse">
          <path
            d={`M ${size} 0 L 0 0 0 ${size}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Spotlight — React Bits. A soft radial follows the cursor on hover.  */
/* ------------------------------------------------------------------ */

export function Spotlight({
  children,
  className = "",
  color = "oklch(0.64 0.15 152 / 0.18)",
}: {
  children: ReactNode;
  className?: string;
  color?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(-200);
  const y = useMotionValue(-200);
  const background = useTransform(
    [x, y],
    ([lx, ly]) => `radial-gradient(220px circle at ${lx}px ${ly}px, ${color}, transparent 70%)`,
  );

  return (
    <div
      ref={ref}
      onMouseMove={(e) => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        x.set(e.clientX - r.left);
        y.set(e.clientY - r.top);
      }}
      onMouseLeave={() => {
        x.set(-200);
        y.set(-200);
      }}
      className={`group relative overflow-hidden ${className}`}
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background }}
      />
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* FloatIn — small motion wrapper for hero decorations.                */
/* ------------------------------------------------------------------ */

export function FloatIn({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ delay, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
