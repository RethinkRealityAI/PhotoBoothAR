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
import type { ResolvedScene } from '../../lib/sceneThemes';

interface Props {
  scene: ResolvedScene;
  /** Preview thumbnails pass false: no drifting layers in a 200px card. */
  animated?: boolean;
}

export default function WallBackdrop({ scene, animated = true }: Props) {
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
        animated && (
          <>
            <div className="wall-backdrop-glow wall-backdrop-glow-a" style={{ background: scene.accent }} />
            <div className="wall-backdrop-glow wall-backdrop-glow-b" style={{ background: scene.accent }} />
          </>
        )
      )}
    </div>
  );
}
