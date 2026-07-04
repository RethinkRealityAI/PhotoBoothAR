/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Confetti — sparse, slow-falling confetti shapes in the accent palette.
 * Celebratory but subtle: low opacity, gentle rotation, long fall times.
 * Reduced motion freezes pieces scattered at their static positions.
 */
import { useMemo } from 'react';
import { BackgroundShell, clampCount, mulberry32, type AmbientBackgroundProps } from './shared';

const CSS = `
@keyframes pbbg-confetti-fall {
  0%   { opacity: 0; }
  6%   { opacity: var(--pc-o, 0.4); }
  82%  { opacity: var(--pc-o, 0.4); }
  100% { transform: translate3d(var(--pc-dx, 0px), 118cqh, 0) rotate(var(--pc-rot, 480deg)); opacity: 0; }
}`;

const COLORS = ['var(--color-accent)', 'var(--color-accent-2)', 'var(--color-accent-3)'];

export default function Confetti({ density, className }: AmbientBackgroundProps) {
  const count = clampCount(density, 20, 10, 28);
  const pieces = useMemo(() => {
    const rand = mulberry32(0xc0ffe);
    return Array.from({ length: count }, (_, i) => {
      const kind = i % 3; // 0 rect, 1 circle, 2 ribbon
      return {
        id: i,
        kind,
        left: rand() * 100,
        top: rand() * 100 - 12,
        w: kind === 1 ? 5 + rand() * 3 : 4 + rand() * 4,
        h: kind === 1 ? 0 : kind === 2 ? 12 + rand() * 8 : 7 + rand() * 5,
        color: COLORS[i % COLORS.length],
        opacity: (0.22 + rand() * 0.26).toFixed(2),
        dx: `${(rand() * 2 - 1) * 60}px`,
        rot: `${Math.round((rand() * 2 - 1) * 720)}deg`,
        tilt: Math.round(rand() * 180),
        duration: 18 + rand() * 14,
        delay: -rand() * 32,
      };
    });
  }, [count]);

  return (
    <BackgroundShell variant="confetti" css={CSS} className={className}>
      {pieces.map((p) => (
        <span
          key={p.id}
          className="absolute"
          style={{
            left: `${p.left}%`,
            top: `${p.top}%`,
            width: p.w,
            height: p.kind === 1 ? p.w : p.h,
            background: p.color,
            opacity: Number(p.opacity),
            borderRadius: p.kind === 1 ? '9999px' : 1,
            rotate: `${p.tilt}deg`,
            ['--pc-o' as string]: p.opacity,
            ['--pc-dx' as string]: p.dx,
            ['--pc-rot' as string]: p.rot,
            animation: `pbbg-confetti-fall ${p.duration}s linear ${p.delay}s infinite`,
          }}
        />
      ))}
    </BackgroundShell>
  );
}
