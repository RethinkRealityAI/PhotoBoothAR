/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bokeh — slow floating blurred light orbs in the accent palette. CSS-only;
 * orbs drift back and forth (alternate) so the loop never visibly wraps.
 */
import { useMemo } from 'react';
import { BackgroundShell, clampCount, mulberry32, type AmbientBackgroundProps } from './shared';

const CSS = `
@keyframes pbbg-bokeh-drift {
  from { transform: translate3d(0, 0, 0) scale(1); }
  to   { transform: translate3d(var(--pb-dx, 5%), var(--pb-dy, -7%), 0) scale(var(--pb-s, 1.12)); }
}`;

const TINTS = [
  'rgba(var(--accent-rgb), 0.20)',
  'color-mix(in srgb, var(--color-accent-2) 22%, transparent)',
  'color-mix(in srgb, var(--color-accent-3) 24%, transparent)',
];

export default function Bokeh({ density, className }: AmbientBackgroundProps) {
  const count = clampCount(density !== undefined ? density / 3 : undefined, 9, 5, 14);
  const orbs = useMemo(() => {
    const rand = mulberry32(0xb0cea);
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      left: rand() * 96 - 6,
      top: rand() * 96 - 6,
      size: 9 + rand() * 16,               // cqmin (≈ vmin when full-bleed)
      blur: 14 + rand() * 18,
      opacity: 0.35 + rand() * 0.4,
      tint: TINTS[i % TINTS.length],
      dx: `${(rand() * 2 - 1) * 7}%`,
      dy: `${(rand() * 2 - 1) * 9}%`,
      scale: (0.92 + rand() * 0.3).toFixed(2),
      duration: 16 + rand() * 20,
      delay: -rand() * 30,
    }));
  }, [count]);

  return (
    <BackgroundShell variant="bokeh" css={CSS} className={className}>
      {orbs.map((o) => (
        <span
          key={o.id}
          className="absolute rounded-full"
          style={{
            left: `${o.left}%`,
            top: `${o.top}%`,
            width: `${o.size}cqmin`,
            height: `${o.size}cqmin`,
            opacity: o.opacity,
            background: `radial-gradient(circle, ${o.tint}, transparent 70%)`,
            filter: `blur(${o.blur}px)`,
            ['--pb-dx' as string]: o.dx,
            ['--pb-dy' as string]: o.dy,
            ['--pb-s' as string]: o.scale,
            animation: `pbbg-bokeh-drift ${o.duration}s ease-in-out ${o.delay}s infinite alternate`,
          }}
        />
      ))}
    </BackgroundShell>
  );
}
