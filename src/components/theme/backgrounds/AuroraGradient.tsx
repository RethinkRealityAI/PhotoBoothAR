/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AuroraGradient — drifting soft accent gradients over the brand base.
 * The runtime default; absorbs the look of the old generic DefaultBackground
 * (two glowing accent pools) but drifts instead of pulsing in place.
 */
import { BackgroundShell, type AmbientBackgroundProps } from './shared';

const CSS = `
@keyframes pbbg-aurora-a {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); opacity: 0.85; }
  50%      { transform: translate3d(7%, 5%, 0) scale(1.14); opacity: 1; }
}
@keyframes pbbg-aurora-b {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1.08); opacity: 1; }
  50%      { transform: translate3d(-6%, -5%, 0) scale(0.94); opacity: 0.75; }
}
@keyframes pbbg-aurora-ribbon {
  0%, 100% { transform: translate3d(-4%, 0, 0) rotate(-14deg); opacity: 0.6; }
  50%      { transform: translate3d(4%, -3%, 0) rotate(-10deg); opacity: 1; }
}`;

export default function AuroraGradient({ className }: AmbientBackgroundProps) {
  return (
    <BackgroundShell variant="aurora" css={CSS} className={className}>
      <div
        className="absolute rounded-full"
        style={{
          top: '-22%', left: '-18%', width: '68%', height: '68%',
          background: 'radial-gradient(circle, rgba(var(--accent-rgb),0.13), transparent 70%)',
          filter: 'blur(48px)',
          animation: 'pbbg-aurora-a 18s ease-in-out infinite',
        }}
      />
      <div
        className="absolute rounded-full"
        style={{
          bottom: '-24%', right: '-18%', width: '72%', height: '72%',
          background: 'radial-gradient(circle, rgba(var(--accent-rgb),0.10), transparent 70%)',
          filter: 'blur(56px)',
          animation: 'pbbg-aurora-b 24s ease-in-out infinite',
        }}
      />
      {/* wide diagonal aurora ribbon across the midline */}
      <div
        className="absolute"
        style={{
          top: '28%', left: '-15%', width: '130%', height: '34%',
          background:
            'linear-gradient(100deg, transparent 8%, rgba(var(--accent-rgb),0.07) 34%, color-mix(in srgb, var(--color-accent-2) 9%, transparent) 55%, transparent 88%)',
          filter: 'blur(34px)',
          borderRadius: '50%',
          animation: 'pbbg-aurora-ribbon 30s ease-in-out infinite',
        }}
      />
    </BackgroundShell>
  );
}
