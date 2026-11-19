/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The selfie's DOM-side effects, shared by the standalone BeamySelfie widget
 * and the /beamy hero (which plays the same `Selfie` clip on its main stage):
 * the camera-flash gradient, Beamy's own portrait cropped from a WebGL
 * canvas, and the photo card's look. The cue timing lives in the PURE
 * lib/beamySelfie.ts; this module only paints.
 */
import type { CSSProperties } from 'react';

export const PERIWINKLE = '142,150,255';
export const AMBER = '255,197,107';

/**
 * A 4:5 portrait cropped from a WebGL canvas around his head (`head` in CSS
 * px; `cropW` = crop width in CSS px), over a periwinkle-to-amber backdrop.
 * Throws if the canvas cannot be read; the caller keeps the card's face then.
 * Call it in the same task as a render so the drawing buffer is valid.
 */
export function snapshotPortrait(src: HTMLCanvasElement, head: { x: number; y: number }, cropW: number, cssW: number): string {
  const k = src.width / Math.max(1, cssW); // device px per CSS px
  const sw = cropW * k;
  const sh = sw * 1.25;
  const sx = head.x * k - sw / 2;
  const sy = head.y * k - sh * 0.18; // the top of his head near the top of the frame
  const out = document.createElement('canvas');
  out.width = 320;
  out.height = 400;
  const g = out.getContext('2d');
  if (g === null) throw new Error('no 2d context');
  const bg = g.createRadialGradient(160, 150, 10, 160, 200, 300);
  bg.addColorStop(0, `rgb(${AMBER})`);
  bg.addColorStop(0.45, `rgb(${PERIWINKLE})`);
  bg.addColorStop(1, '#2b2f6b');
  g.fillStyle = bg;
  g.fillRect(0, 0, out.width, out.height);
  g.drawImage(src, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.85);
}

/** The flash overlay's background at a point; reduced motion = a dim, soft bloom. */
export function flashGradient(x: number, y: number, reduced: boolean): string {
  const at = `${x.toFixed(0)}px ${y.toFixed(0)}px`;
  return reduced
    ? `radial-gradient(circle at ${at}, rgba(255,250,240,0.9) 0%, rgba(${PERIWINKLE},0.5) 45%, rgba(${PERIWINKLE},0) 90%)`
    : `radial-gradient(circle at ${at}, rgba(255,252,246,1) 0%, rgba(${AMBER},0.95) 8%, rgba(255,255,255,0.85) 22%, rgba(${PERIWINKLE},0.55) 55%, rgba(${PERIWINKLE},0.18) 85%, rgba(${PERIWINKLE},0) 100%)`;
}

/** The polaroid-like photo card (position + size are set per frame). */
export const SELFIE_CARD_STYLE: CSSProperties = {
  borderRadius: 6,
  background: '#FFF8EC',
  boxShadow: `0 0 18px rgba(${PERIWINKLE},0.55), 0 0 4px rgba(${AMBER},0.6)`,
  transformOrigin: '50% 50%',
};

/** The card's photo window (insets, not padding: % padding resolves against the container's width). */
export const SELFIE_CARD_FACE_STYLE: CSSProperties = {
  position: 'absolute',
  left: '7%',
  right: '7%',
  top: '6%',
  bottom: '20%',
  borderRadius: 3,
  overflow: 'hidden',
  background: `radial-gradient(circle at 50% 40%, rgba(${AMBER},0.55), rgba(${PERIWINKLE},0.85) 60%, #2b2f6b 100%)`,
};
