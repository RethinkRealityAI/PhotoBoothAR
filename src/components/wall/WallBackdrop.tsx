/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WallBackdrop — what a platform wall paints behind its photos when the host
 * picked a backdrop in Wall design (lib/sceneThemes.resolveWallBackdrop):
 * a palette gradient, a solid colour, or their own full-bleed image under a
 * legibility scrim. Two slow glow pools drift over gradients and colours so a
 * six-hour projection never reads as a flat slide; they stop dead under
 * prefers-reduced-motion. `null` from the resolver means "follow the event"
 * and the wall keeps rendering EventBackground instead — this component is
 * never mounted for legacy builds.
 */
import type { ResolvedScene, WallAmbient } from '../../lib/sceneThemes';

interface Props {
  scene: ResolvedScene;
  /** Preview thumbnails pass false: no drifting layers in a 200px card. */
  animated?: boolean;
  /** The host's ambience pick: drifting glow (today), twinkles, or still. */
  ambient?: WallAmbient;
}

/** Deterministic star field (no Math.random: every screen and every render
 *  of the same wall twinkles identically). */
const TWINKLES = Array.from({ length: 46 }, (_, i) => {
  const h = (n: number) => {
    const x = Math.sin((i + 1) * n) * 43758.5453;
    return x - Math.floor(x);
  };
  return { left: h(12.99) * 100, top: h(78.23) * 100, size: 1.5 + h(37.7) * 3, delay: h(4.1) * 5, dur: 3.8 + h(9.3) * 3.4 };
});

/** Twinkling lights in the glow colour (`--wall-glow-rgb`). */
export function WallTwinkles() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      {TWINKLES.map((t, i) => (
        <span
          key={i}
          className="wall-twinkle"
          style={{
            left: `${t.left}%`,
            top: `${t.top}%`,
            width: `calc(${t.size.toFixed(2)}px * var(--wall-scale, 1))`,
            height: `calc(${t.size.toFixed(2)}px * var(--wall-scale, 1))`,
            animationDelay: `${t.delay.toFixed(2)}s`,
            animationDuration: `${t.dur.toFixed(2)}s`,
          }}
        />
      ))}
    </div>
  );
}

export default function WallBackdrop({ scene, animated = true, ambient = 'glow' }: Props) {
  const drift = animated && ambient !== 'still';
  const light = scene.tone === 'light';
  const scrim = light ? `rgba(246, 245, 252, ${scene.dim})` : `rgba(10, 9, 32, ${scene.dim})`;
  return (
    <div className="wall-backdrop absolute inset-0 overflow-hidden pointer-events-none" aria-hidden style={{ background: scene.background }}>
      {scene.imageUrl !== undefined ? (
        <>
          <img
            src={scene.imageUrl}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full"
            style={{ objectFit: scene.imageFit ?? 'cover' }}
          />
          <div className="absolute inset-0" style={{ background: scrim }} />
          {/* A soft vignette keeps the edges (where the chrome lives) calm. */}
          <div
            className="absolute inset-0"
            style={{
              background: light
                ? 'radial-gradient(120% 90% at 50% 40%, transparent 55%, rgba(236, 234, 248, 0.55) 100%)'
                : 'radial-gradient(120% 90% at 50% 40%, transparent 50%, rgba(8, 7, 26, 0.6) 100%)',
            }}
          />
        </>
      ) : (
        drift && (
          <>
            <div className="wall-backdrop-glow wall-backdrop-glow-a" style={{ background: scene.accent }} />
            <div className="wall-backdrop-glow wall-backdrop-glow-b" style={{ background: scene.accent }} />
          </>
        )
      )}
      {ambient === 'sparkle' && animated && <WallTwinkles />}
    </div>
  );
}
