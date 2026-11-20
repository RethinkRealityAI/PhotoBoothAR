/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Card REVEAL contract — the opening moment on /c/:publicId.
 * ==========================================================
 *
 * A reveal is the few seconds between "the link opened" and "the card is on
 * screen": an envelope that unfolds, a curtain that parts onto a floating 3D
 * card, a paper airplane, stardust. CardExperience mounts exactly one reveal
 * as a full-screen layer, and mounts the chosen card TEMPLATE only once the
 * reveal calls `onDone` (so a WebGL reveal and a WebGL template never hold two
 * GPU contexts at once on a phone). After `onDone` the experience fades the
 * reveal layer out over REVEAL_HANDOFF_MS, so the reveal's last frame should
 * already look like "the card, arriving": end on the card face, not on black.
 *
 * Rules every reveal follows:
 *   • WAIT FOR A TAP before the big moment (a seal, "Open", the plane). The
 *     tap is the recipient's gesture, which is also what lets the template's
 *     videos play with sound afterwards. Ambient idle motion before the tap
 *     is fine. Enter/Space must open it too (keyboard + screen readers), and
 *     the tap target is a real <button> of at least 44x44px.
 *   • NEVER skip because of prefers-reduced-motion. The recipient asked for
 *     this moment by tapping, and the owner's own phone reports Reduce
 *     Motion. Instead, when `reducedMotion` is true: no camera shake, no fast
 *     spins or zooms, fewer particles, gentler and shorter moves. The
 *     experience always offers a Skip button on top, so nobody is trapped.
 *   • Call `onDone` exactly once. Total length after the tap: 2.5 to 6 s.
 *   • Text: the card title (it already says "Happy birthday" or the like).
 *     Name the recipient at most once (an envelope addressed "For Dapo" is
 *     natural; repeating it is what the owner called redundant). Never the
 *     event's name. Sentence case, never below 12px, white ink on the dusk
 *     look (brand v2: src/styles/brand.css --bw-*), no gradient text/buttons.
 *   • Read colours from the semantic CSS tokens (--color-accent, --accent-rgb,
 *     --color-brand-bg/fg) so the event look works too; in three.js read them
 *     once with getComputedStyle(document.documentElement) — or from the
 *     `palette` prop, which is the same values already resolved.
 *   • Clean up: every rAF, timer, listener, texture, geometry and material is
 *     released on unmount (the experience unmounts the reveal after handoff,
 *     and Replay mounts a fresh one).
 *   • WebGL reveals are lazy chunks (registry.ts) and only ever run where
 *     hasWebGL() is true; the experience substitutes the fallback otherwise.
 */
import type { CardViewContribution, CardViewData } from '../../../lib/cards';
import type { CardPalette } from '../../../lib/cardPresentation';

/** How long CardExperience cross-fades the reveal layer out after onDone. */
export const REVEAL_HANDOFF_MS = 700;

/** The card's colours, already resolved for the chosen look (lib/cardPresentation.ts cardPalette). */
export type RevealPalette = CardPalette;

export interface CardRevealProps {
  card: CardViewData;
  contributions: CardViewContribution[];
  look: 'beamwall' | 'event';
  palette: RevealPalette;
  reducedMotion: boolean;
  /** The card face is on screen — hand over to the template. Call once. */
  onDone: () => void;
}

/** Photos first (they are what makes a reveal feel personal), max `n`. */
export function revealPhotos(contributions: CardViewContribution[], n = 6): string[] {
  const out: string[] = [];
  for (const c of contributions) {
    if (c.mediaType === 'photo' && c.url) out.push(c.url);
    if (out.length >= n) break;
  }
  return out;
}
