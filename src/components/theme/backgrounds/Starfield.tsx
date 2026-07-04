/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Starfield — tiny twinkling accent points with an occasional shooting streak.
 * Stars sit at static scattered positions (visible even with animations off);
 * only their opacity pulses. Streaks are hidden at rest and sweep rarely.
 */
import { useMemo } from 'react';
import { BackgroundShell, clampCount, mulberry32, type AmbientBackgroundProps } from './shared';

const CSS = `
@keyframes pbbg-star-twinkle {
  0%, 100% { opacity: var(--ps-min, 0.2); transform: scale(1); }
  50%      { opacity: var(--ps-max, 0.9); transform: scale(1.35); }
}
@keyframes pbbg-star-shoot {
  0%, 88% { opacity: 0; transform: translate3d(0, 0, 0) rotate(-32deg); }
  90%     { opacity: 0.85; }
  100%    { opacity: 0; transform: translate3d(-46cqw, 29cqw, 0) rotate(-32deg); }
}`;

export default function Starfield({ density, sparkle, className }: AmbientBackgroundProps) {
  const count = clampCount(density !== undefined ? density * 2 : undefined, 56, 24, 90);
  const stars = useMemo(() => {
    const rand = mulberry32(0x57a2);
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      left: rand() * 100,
      top: rand() * 100,
      size: 1 + rand() * 1.8,
      min: (0.12 + rand() * 0.2).toFixed(2),
      max: (0.55 + rand() * 0.45).toFixed(2),
      duration: 2.6 + rand() * 4.6,
      delay: -rand() * 8,
      bright: i % 5 === 0,
    }));
  }, [count]);

  const streaks = (sparkle ?? 1) > 0 ? [
    { id: 0, left: 68, top: 12, duration: 11, delay: -3 },
    { id: 1, left: 88, top: 34, duration: 17, delay: -9.5 },
  ] : [];

  return (
    <BackgroundShell variant="starfield" css={CSS} className={className}>
      {stars.map((s) => (
        <span
          key={s.id}
          className="absolute rounded-full"
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            width: s.size,
            height: s.size,
            opacity: Number(s.min),
            background: s.bright ? 'var(--color-accent-2)' : 'var(--color-brand-muted)',
            boxShadow: s.bright ? '0 0 6px rgba(var(--accent-rgb),0.8)' : 'none',
            ['--ps-min' as string]: s.min,
            ['--ps-max' as string]: s.max,
            animation: `pbbg-star-twinkle ${s.duration}s ease-in-out ${s.delay}s infinite`,
          }}
        />
      ))}
      {streaks.map((k) => (
        <span
          key={`k${k.id}`}
          className="absolute"
          style={{
            left: `${k.left}%`,
            top: `${k.top}%`,
            width: 130,
            height: 1.5,
            opacity: 0,
            borderRadius: 9999,
            background:
              'linear-gradient(90deg, transparent, var(--color-accent-2) 45%, transparent)',
            animation: `pbbg-star-shoot ${k.duration}s ease-in ${k.delay}s infinite`,
          }}
        />
      ))}
    </BackgroundShell>
  );
}
