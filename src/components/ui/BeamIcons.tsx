/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BeamIcons — bespoke gradient-stroked SVG icons for the Beamwall platform's
 * marketing surfaces. Hand-drawn line glyphs with a per-instance linear
 * gradient (useId keeps gradient defs unique when an icon appears twice on a
 * page), sized via the `size` prop. More premium and on-brand than stock
 * icon-font glyphs: every icon carries the beam spectrum in its stroke.
 */
import { useId, type ReactNode } from 'react';

export interface BeamIconProps {
  size?: number;
  /** Gradient stops, brightest first. Defaults to the beam blue→violet. */
  from?: string;
  to?: string;
  className?: string;
}

function IconShell({
  size = 28,
  from = '#5B8CFF',
  to = '#7C6CF7',
  className = '',
  children,
}: BeamIconProps & { children: (stroke: string) => ReactNode }) {
  const id = useId();
  const gradId = `beamicon-${id}`;
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      {children(`url(#${gradId})`)}
    </svg>
  );
}

/** AR booth — camera aperture with an orbiting spark. */
export function BoothIcon(props: BeamIconProps) {
  return (
    <IconShell {...props}>
      {(stroke) => (
        <g stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4.5" y="8" width="23" height="17" rx="4.5" />
          <path d="M11.5 8l1.6-2.6a1.6 1.6 0 0 1 1.36-.76h3.08a1.6 1.6 0 0 1 1.36.76L20.5 8" />
          <circle cx="16" cy="16.5" r="4.6" />
          <circle cx="16" cy="16.5" r="1.1" fill={stroke} stroke="none" />
          <path d="M24.6 4.4l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" fill={stroke} stroke="none" />
        </g>
      )}
    </IconShell>
  );
}

/** Live wall — staggered gallery frames with a beam rising through them. */
export function WallIcon(props: BeamIconProps) {
  return (
    <IconShell {...props}>
      {(stroke) => (
        <g stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="5" width="10.5" height="13" rx="2.2" />
          <rect x="17.5" y="9" width="10.5" height="13" rx="2.2" />
          <rect x="7.5" y="21" width="10.5" height="6.5" rx="2.2" />
          <path d="M22.7 4.5v2.6M22.7 24.8v2.6" strokeDasharray="0.1 3" />
        </g>
      )}
    </IconShell>
  );
}

/** Challenges — trophy cup with a burst above it. */
export function ChallengeIcon(props: BeamIconProps) {
  return (
    <IconShell {...props}>
      {(stroke) => (
        <g stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.5 7h11v6.2a5.5 5.5 0 0 1-11 0z" />
          <path d="M10.5 8.6H7.2a0 0 0 0 0 0 0c0 3.1 1.4 5 3.6 5.6M21.5 8.6h3.3c0 3.1-1.4 5-3.6 5.6" />
          <path d="M16 18.7v3.6M12 25.6h8M13.5 22.3h5" />
          <path d="M16 2.4l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z" fill={stroke} stroke="none" />
        </g>
      )}
    </IconShell>
  );
}

/** Keepsake cards — open card with a rising heart-spark. */
export function CardIcon(props: BeamIconProps) {
  return (
    <IconShell {...props}>
      {(stroke) => (
        <g stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5.5 11.5L16 7l10.5 4.5v13a2.5 2.5 0 0 1-2.5 2.5H8a2.5 2.5 0 0 1-2.5-2.5z" />
          <path d="M5.5 12l10.5 6.5L26.5 12" />
          <path d="M16 4.8c.9-1.6 3.4-1.4 3.4.5 0 1.3-1.9 2.6-3.4 3.5-1.5-.9-3.4-2.2-3.4-3.5 0-1.9 2.5-2.1 3.4-.5z" fill={stroke} stroke="none" />
        </g>
      )}
    </IconShell>
  );
}

/** AI studio — wand crossing a frame, sparks trailing. */
export function StudioIcon(props: BeamIconProps) {
  return (
    <IconShell {...props}>
      {(stroke) => (
        <g stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="8" width="16" height="19" rx="3" />
          <path d="M12.5 19.5L26.5 5.5" strokeWidth="1.9" />
          <path d="M25 10.2l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z" fill={stroke} stroke="none" />
          <path d="M9.8 22.4l.4 1 .9.4-.9.4-.4 1-.4-1-.9-.4.9-.4z" fill={stroke} stroke="none" />
        </g>
      )}
    </IconShell>
  );
}

/** Beam — a vertical light shaft breaking through a horizon line. */
export function BeamIcon(props: BeamIconProps) {
  return (
    <IconShell {...props}>
      {(stroke) => (
        <g stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 3.5v18" strokeWidth="2.2" />
          <path d="M11.4 8.5v10M20.6 8.5v10" opacity="0.55" />
          <path d="M5 25.5c3-2.2 7-3.4 11-3.4s8 1.2 11 3.4" />
          <circle cx="16" cy="27.4" r="1.2" fill={stroke} stroke="none" />
        </g>
      )}
    </IconShell>
  );
}
