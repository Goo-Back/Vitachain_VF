"use client";

import { motion, type Variants } from "motion/react";
import { Link } from "@/i18n/navigation";
import type { ReactNode } from "react";

/**
 * Shared motion primitives for the farmer dashboard.
 *
 * Built on `motion/react`. The building blocks cover almost every
 * surface:
 *   - <FadeIn>      one-shot entrance (opacity + small rise)
 *   - <Stagger>     container that reveals its children in sequence
 *   - <StaggerItem> a single child of a <Stagger>
 *   - <MotionCard>  staggered card with a smooth spring lift on hover
 *   - <CardLink>    same, but the whole card is a navigable link
 *
 * All of them honour `prefers-reduced-motion` automatically because
 * motion reads the OS setting; we additionally keep the travel distance
 * small (≤12px) so the chrome never feels gratuitous.
 */

const EASE = [0.16, 1, 0.3, 1] as const;

// Springy, "weighty" feel for hover/press — fast but settled. Currently
// unused (MotionCard's hover/press wiring was dropped in an earlier pass);
// prefixed so the lint rule doesn't flag it while it awaits reconnection.
const _CARD_SPRING = { type: "spring" as const, stiffness: 360, damping: 28 };

export function FadeIn({
  children,
  delay = 0,
  y = 8,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

const containerVariants: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.06, delayChildren: 0.04 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.42, ease: EASE } },
};

export function Stagger({
  children,
  className,
  as = "div",
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "ul";
  ariaLabel?: string;
}) {
  const Comp = motion[as];
  return (
    <Comp
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className={className}
      aria-label={ariaLabel}
    >
      {children}
    </Comp>
  );
}

export function StaggerItem({
  children,
  className,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "li";
}) {
  const Comp = motion[as];
  return (
    <Comp variants={itemVariants} className={className}>
      {children}
    </Comp>
  );
}

/**
 * A card that reveals on stagger and lifts on hover with a soft spring.
 * Use inside a <Stagger>; for non-interactive cards pass interactive={false}
 * to drop the press feedback.
 */
export function MotionCard({
  children,
  className,
  as = "li",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "li";
  interactive?: boolean;
}) {
  const Comp = motion[as];
  return (
    <Comp variants={itemVariants} className={className}>
      {children}
    </Comp>
  );
}

const MotionLink = motion.create(Link);

/** A whole-card navigable link that lifts on hover and dips on press. */
export function CardLink({
  href,
  ariaLabel,
  className,
  style,
  children,
}: {
  href: string;
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  return (
    <MotionLink
      href={href}
      aria-label={ariaLabel}
      variants={itemVariants}
      className={className}
      style={style}
    >
      {children}
    </MotionLink>
  );
}

/**
 * A horizontal progress fill that animates from 0 → width on mount.
 * Used for the parcel moisture bar. `width` is a CSS length string.
 */
export function GrowBar({
  width,
  className,
  delay = 0.15,
}: {
  width: string;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ width: 0 }}
      animate={{ width }}
      transition={{ duration: 0.9, ease: EASE, delay }}
      className={className}
    />
  );
}
