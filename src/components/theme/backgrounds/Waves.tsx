/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Waves — layered translucent SVG wave bands anchored to the bottom edge,
 * slowly shifting sideways (alternate, so there is no seam/wrap jump).
 */
import { BackgroundShell, type AmbientBackgroundProps } from './shared';

const CSS = `
@keyframes pbbg-waves-sway {
  from { transform: translate3d(var(--pw-from, -3%), 0, 0); }
  to   { transform: translate3d(var(--pw-to, 3%), 0, 0); }
}`;

const WAVE_PATH =
  'M0,190 C180,240 360,120 540,165 C720,210 900,110 1080,150 C1260,190 1350,150 1440,170 L1440,320 L0,320 Z';

interface Band {
  id: number;
  fill: string;
  bottom: string;
  height: string;
  duration: number;
  delay: number;
  from: string;
  to: string;
}

const BANDS: Band[] = [
  { id: 0, fill: 'rgba(var(--accent-rgb), 0.05)', bottom: '-4%', height: '52%', duration: 26, delay: -4, from: '-5%', to: '4%' },
  { id: 1, fill: 'color-mix(in srgb, var(--color-accent-3) 10%, transparent)', bottom: '-7%', height: '42%', duration: 19, delay: -11, from: '4%', to: '-5%' },
  { id: 2, fill: 'rgba(var(--accent-rgb), 0.09)', bottom: '-10%', height: '32%', duration: 14, delay: -2, from: '-4%', to: '5%' },
];

export default function Waves({ className }: AmbientBackgroundProps) {
  return (
    <BackgroundShell variant="waves" css={CSS} className={className}>
      {/* soft glow behind the bands so they read on very dark themes */}
      <div
        className="absolute inset-x-0 bottom-0 h-1/2"
        style={{ background: 'linear-gradient(to top, rgba(var(--accent-rgb),0.06), transparent 80%)' }}
      />
      {BANDS.map((b) => (
        <div
          key={b.id}
          className="absolute"
          style={{
            left: '-10%',
            width: '120%',
            bottom: b.bottom,
            height: b.height,
            ['--pw-from' as string]: b.from,
            ['--pw-to' as string]: b.to,
            animation: `pbbg-waves-sway ${b.duration}s ease-in-out ${b.delay}s infinite alternate`,
          }}
        >
          <svg
            className="w-full h-full"
            viewBox="0 0 1440 320"
            preserveAspectRatio="none"
            aria-hidden
          >
            <path d={WAVE_PATH} style={{ fill: b.fill }} />
          </svg>
        </div>
      ))}
    </BackgroundShell>
  );
}
