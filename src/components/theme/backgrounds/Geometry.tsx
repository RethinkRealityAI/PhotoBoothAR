/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Geometry — faint rotating geometric line shapes (rings, a dashed orbit, a
 * rotated square, a hexagon) drawn with hairline accent strokes. Very slow
 * spins; static composition still looks composed with animations off.
 */
import { BackgroundShell, type AmbientBackgroundProps } from './shared';

const CSS = `
@keyframes pbbg-geo-spin     { to { transform: rotate(360deg); } }
@keyframes pbbg-geo-spin-rev { to { transform: rotate(-360deg); } }
@keyframes pbbg-geo-breathe {
  0%, 100% { transform: scale(1); opacity: 0.8; }
  50%      { transform: scale(1.06); opacity: 1; }
}`;

export default function Geometry({ className }: AmbientBackgroundProps) {
  return (
    <BackgroundShell variant="geometry" css={CSS} className={className}>
      {/* faint center glow anchoring the composition */}
      <div
        className="absolute left-1/2 top-1/2 rounded-full"
        style={{
          width: '70cqmin', height: '70cqmin',
          marginLeft: '-35cqmin', marginTop: '-35cqmin',
          background: 'radial-gradient(circle, rgba(var(--accent-rgb),0.07), transparent 65%)',
          filter: 'blur(30px)',
        }}
      />
      {/* breathing outer ring */}
      <div
        className="absolute left-1/2 top-1/2 rounded-full"
        style={{
          width: '78cqmin', height: '78cqmin',
          marginLeft: '-39cqmin', marginTop: '-39cqmin',
          border: '1px solid rgba(var(--accent-rgb),0.14)',
          animation: 'pbbg-geo-breathe 12s ease-in-out infinite',
        }}
      />
      {/* dashed orbit ring, slow spin */}
      <div
        className="absolute left-1/2 top-1/2 rounded-full"
        style={{
          width: '62cqmin', height: '62cqmin',
          marginLeft: '-31cqmin', marginTop: '-31cqmin',
          border: '1px dashed color-mix(in srgb, var(--color-accent-2) 22%, transparent)',
          animation: 'pbbg-geo-spin 140s linear infinite',
        }}
      />
      {/* rotated square outline, counter-spin */}
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          width: '48cqmin', height: '48cqmin',
          marginLeft: '-24cqmin', marginTop: '-24cqmin',
          border: '1px solid rgba(var(--accent-rgb),0.12)',
          transform: 'rotate(45deg)',
          animation: 'pbbg-geo-spin-rev 180s linear infinite',
        }}
      />
      {/* hexagon outline offset top-right */}
      <svg
        className="absolute"
        style={{
          top: '6%', right: '4%', width: '34cqmin', height: '34cqmin',
          animation: 'pbbg-geo-spin 200s linear infinite',
        }}
        viewBox="0 0 100 100"
        aria-hidden
      >
        <polygon
          points="50,4 90,27 90,73 50,96 10,73 10,27"
          fill="none"
          strokeWidth="0.6"
          style={{ stroke: 'color-mix(in srgb, var(--color-accent-3) 30%, transparent)' }}
        />
      </svg>
      {/* small solid ring offset bottom-left */}
      <div
        className="absolute rounded-full"
        style={{
          bottom: '8%', left: '6%', width: '22cqmin', height: '22cqmin',
          border: '1px solid rgba(var(--accent-rgb),0.10)',
          animation: 'pbbg-geo-breathe 16s ease-in-out -6s infinite',
        }}
      />
    </BackgroundShell>
  );
}
