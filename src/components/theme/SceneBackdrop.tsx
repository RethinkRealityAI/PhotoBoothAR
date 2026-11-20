/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Paints a resolved event scene (lib/sceneThemes.resolveScene) full-bleed:
 * the palette field or solid colour, an optional photo (cover, under a
 * legibility scrim) or frame artwork (contain, centred over its palette), and
 * one decorative layer when the look asks for it.
 *
 * Pure CSS + one <img>: no canvas, no WebGL, nothing that competes with the
 * booth camera for the GPU. The motion lives in platform.css
 * (`[data-scene-backdrop]`) and is switched off under prefers-reduced-motion.
 *
 * Used by EventBackground (guest pages) and, at thumbnail size, by the host's
 * look picker — the same component, so a preview cannot drift from the page.
 */
import type { CSSProperties } from 'react';
import { withAlpha, type ResolvedScene } from '../../lib/sceneThemes';

export interface SceneBackdropProps {
  scene: ResolvedScene;
  className?: string;
  /** Thumbnail use: lighter ornament, no motion. */
  compact?: boolean;
  /** Ask the page around it to take the scene's tone (guest pages only —
   *  see EventBackground). Rendered as `data-scene-flip`. */
  flipTone?: boolean;
}

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)'/%3E%3C/svg%3E\")";

/** Thin gold corner line-art — the opt-in 'gilded' look only. */
function GildedCorners({ compact }: { compact: boolean }) {
  const size = compact ? 34 : 120;
  const corner = (rotate: number, pos: CSSProperties) => (
    <svg
      key={rotate}
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className="absolute"
      style={{ ...pos, transform: `rotate(${rotate}deg)` }}
      fill="none"
      stroke="#D9B865"
      strokeOpacity={0.7}
      aria-hidden
    >
      <path d="M8 112 V20 Q8 8 20 8 H112" strokeWidth={1.6} />
      <path d="M18 112 V30 Q18 18 30 18 H112" strokeWidth={0.8} strokeOpacity={0.5} />
      <circle cx="20" cy="20" r="3" fill="#D9B865" stroke="none" fillOpacity={0.8} />
    </svg>
  );
  const inset = compact ? 6 : 'max(16px, 2.5vw)';
  return (
    <div className="absolute inset-0" aria-hidden>
      {corner(0, { top: inset, left: inset })}
      {corner(90, { top: inset, right: inset })}
      {corner(180, { bottom: inset, right: inset })}
      {corner(270, { bottom: inset, left: inset })}
    </div>
  );
}

export default function SceneBackdrop({ scene, className = '', compact = false, flipTone = false }: SceneBackdropProps) {
  const light = scene.tone === 'light';
  const glow = withAlpha(scene.accent, light ? 0.55 : 0.38);
  return (
    <div
      aria-hidden
      data-scene-backdrop=""
      data-scene-tone={scene.tone}
      data-scene-flip={flipTone ? scene.tone : undefined}
      data-compact={compact ? '' : undefined}
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      style={{ background: scene.background, ['--scene-glow' as string]: glow }}
    >
      {scene.imageUrl !== undefined && (
        scene.imageFit === 'contain' ? (
          // Frame artwork: shown whole and centred, the palette around it.
          <img
            src={scene.imageUrl}
            alt=""
            decoding="async"
            className="absolute inset-0 h-full w-full object-contain p-[4%]"
            style={{ filter: 'drop-shadow(0 24px 48px rgba(10, 8, 40, 0.35))' }}
          />
        ) : (
          <img
            src={scene.imageUrl}
            alt=""
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
        )
      )}
      {scene.dim > 0 && (
        <div
          className="absolute inset-0"
          style={{ background: light ? `rgba(248, 246, 255, ${scene.dim})` : `rgba(12, 10, 36, ${scene.dim})` }}
        />
      )}

      {scene.ornament === 'beams' && (
        <div className="scene-beams absolute inset-0">
          <span /><span /><span />
        </div>
      )}
      {scene.ornament === 'orbs' && (
        <div className="scene-orbs absolute inset-0">
          <span /><span /><span />
        </div>
      )}
      {scene.ornament === 'grain' && (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: GRAIN,
            backgroundSize: compact ? '90px 90px' : '180px 180px',
            opacity: light ? 0.22 : 0.16,
            mixBlendMode: light ? 'multiply' : 'soft-light',
          }}
        />
      )}
      {scene.ornament === 'gilded' && <GildedCorners compact={compact} />}

      {/* Edge vignette: depth, and calmer corners under the page chrome. */}
      <div
        className="absolute inset-0"
        style={{
          background: light
            ? 'radial-gradient(120% 90% at 50% 40%, transparent 55%, rgba(60, 54, 120, 0.10) 100%)'
            : 'radial-gradient(120% 90% at 50% 40%, transparent 50%, rgba(8, 6, 30, 0.45) 100%)',
        }}
      />
    </div>
  );
}
