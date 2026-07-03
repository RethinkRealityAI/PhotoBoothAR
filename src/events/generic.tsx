/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Generic visuals for runtime (DB-configured) events that have no coded
 * Logo/Background components. The wordmark renders the event name as a styled
 * text lockup (an admin-uploaded logo image overrides it via the existing
 * branding system), and the background is a subtle animated gradient driven
 * entirely by the CSS theme variables so it recolors with the event's theme.
 */
import type { ComponentType } from 'react';

const WORDMARK_FONT_PX: Record<'sm' | 'md' | 'lg' | 'xl', number> = {
  sm: 24,
  md: 36,
  lg: 52,
  xl: 68,
};

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || '✦';
}

export interface GenericVisuals {
  Wordmark: ComponentType<{ size?: 'sm' | 'md' | 'lg' | 'xl' }>;
  Mark: ComponentType;
  Emblem: ComponentType<{ size?: number; className?: string }>;
}

/** Build a Wordmark/Mark/Emblem trio that renders the event name as text. */
export function createGenericVisuals(name: string): GenericVisuals {
  const initials = initialsOf(name);

  function GenericEmblem({ size = 34, className }: { size?: number; className?: string }) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-full select-none ${className ?? ''}`}
        style={{
          width: size,
          height: size,
          border: '1px solid rgba(var(--accent-rgb),0.55)',
          background: 'rgba(var(--accent-rgb),0.10)',
          color: 'var(--color-accent)',
          fontFamily: 'var(--font-serif)',
          fontStyle: 'italic',
          fontWeight: 600,
          fontSize: Math.max(10, Math.round(size * 0.42)),
          lineHeight: 1,
        }}
        aria-hidden
      >
        {initials}
      </span>
    );
  }

  function GenericWordmark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' | 'xl' }) {
    return (
      <span
        className="text-foil-static select-none"
        style={{
          fontFamily: 'var(--font-serif)',
          fontStyle: 'italic',
          fontWeight: 600,
          fontSize: WORDMARK_FONT_PX[size],
          lineHeight: 1.1,
          whiteSpace: 'nowrap',
          maxWidth: '90vw',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: 'inline-block',
        }}
      >
        {name}
      </span>
    );
  }

  function GenericMark() {
    return <GenericEmblem size={36} />;
  }

  return { Wordmark: GenericWordmark, Mark: GenericMark, Emblem: GenericEmblem };
}

/**
 * Default ambient background for runtime events: a subtle animated gradient
 * built from the theme variables (--color-brand-bg/-surface + --accent-rgb).
 * Same contract as the coded events' Background components: pointer-events-none,
 * absolute inset-0, never blocks UI.
 */
export function DefaultBackground({ className }: { density?: number; className?: string; sparkle?: number }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className ?? ''}`} aria-hidden>
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(130% 100% at 50% 0%, var(--color-brand-surface) 0%, var(--color-brand-bg) 62%)',
        }}
      />
      <div
        className="absolute rounded-full animate-pulse"
        style={{
          top: '-22%',
          left: '-18%',
          width: '68%',
          height: '68%',
          background: 'radial-gradient(circle, rgba(var(--accent-rgb),0.12), transparent 70%)',
          filter: 'blur(48px)',
          animationDuration: '9s',
        }}
      />
      <div
        className="absolute rounded-full animate-pulse"
        style={{
          bottom: '-24%',
          right: '-18%',
          width: '72%',
          height: '72%',
          background: 'radial-gradient(circle, rgba(var(--accent-rgb),0.09), transparent 70%)',
          filter: 'blur(56px)',
          animationDuration: '13s',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 42%, transparent 55%, rgba(0,0,0,0.35) 100%)',
        }}
      />
    </div>
  );
}
