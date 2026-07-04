/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared plumbing for the parameterized ambient background templates.
 *
 * Every template reads ONLY the runtime CSS theme variables
 * (--color-brand-bg/-surface/-fg, --color-accent/-2/-3, --accent-rgb) so the
 * admin branding overrides recolor them live, exactly like DefaultBackground.
 *
 * Contract (same as the coded events' Background components):
 *   pointer-events-none, absolute inset-0, overflow-hidden, aria-hidden —
 *   covers the viewport behind content and never blocks UI.
 *
 * Motion is CSS-only (transform/opacity keyframes, no canvas/RAF). Each shell
 * injects a `prefers-reduced-motion` rule that disables its animations, so the
 * scene freezes at each element's static inline styles.
 *
 * The shell is a CSS size container, so templates size their motifs with
 * container-query units (cqmin/cqh/cqw) instead of viewport units — full-bleed
 * behind an app screen they equal vmin/vh/vw, but inside the admin picker's
 * small preview cards the whole scene scales down faithfully.
 */
import type { CSSProperties, ReactNode } from 'react';

export interface AmbientBackgroundProps {
  /** Particle-count hint — screens pass lower values on mobile/booth. */
  density?: number;
  /** Relative twinkle/accent intensity (0 = none). */
  sparkle?: number;
  className?: string;
}

/** Deterministic PRNG (mulberry32) so layouts are stable across re-renders. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Clamp a density hint into a template's comfortable particle range. */
export function clampCount(density: number | undefined, fallback: number, min: number, max: number): number {
  const n = typeof density === 'number' && Number.isFinite(density) ? Math.round(density) : fallback;
  return Math.max(min, Math.min(max, n));
}

const BASE_STYLE: CSSProperties = {
  background: 'radial-gradient(130% 100% at 50% 0%, var(--color-brand-surface) 0%, var(--color-brand-bg) 62%)',
};

const VIGNETTE_STYLE: CSSProperties = {
  background: 'radial-gradient(120% 90% at 50% 42%, transparent 55%, rgba(0,0,0,0.35) 100%)',
};

interface ShellProps {
  /** Unique per-template slug — namespaces the injected keyframes/rules. */
  variant: string;
  /** Keyframes + rules for this template (names must be `pbbg-<variant>-…`). */
  css: string;
  className?: string;
  children: ReactNode;
}

/**
 * Common wrapper: theme-var base gradient below, template motif in the middle,
 * soft vignette on top. The <style> tag is idempotent (same text every render)
 * and scoped by the pbbg-<variant> class, so multiple mounts are harmless.
 */
export function BackgroundShell({ variant, css, className, children }: ShellProps) {
  return (
    <div
      className={`pbbg-${variant} pointer-events-none absolute inset-0 overflow-hidden ${className ?? ''}`}
      style={{ containerType: 'size' }}
      aria-hidden
    >
      <style>{`${css}
@media (prefers-reduced-motion: reduce) {
  .pbbg-${variant}, .pbbg-${variant} * { animation: none !important; }
}`}</style>
      <div className="absolute inset-0" style={BASE_STYLE} />
      {children}
      <div className="absolute inset-0" style={VIGNETTE_STYLE} />
    </div>
  );
}
