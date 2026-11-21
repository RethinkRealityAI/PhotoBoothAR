/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ShineText — a word set with the glow CTA's travelling light on its
 * OUTLINE only (brand.css .bw-shine): the hero's IMMERSIVE BOOTH and the
 * AR step's titles share this one component so they cannot drift. The
 * fill stays solid ink (never gradient text); the shimmer is decor, so it
 * holds still under reduced motion.
 *
 *   • 'outline': a glimmer travelling along the letter outlines;
 *   • 'rim': a glass rim around the word with the light orbiting it.
 */
export type ShineStyle = 'outline' | 'rim';

/** The shipped treatment (the other is kept for comparison). */
export const SHINE_STYLE: ShineStyle = 'outline';

export default function ShineText({ text, className = '', style = SHINE_STYLE }: { text: string; className?: string; style?: ShineStyle }) {
  return <span className={`bw-shine ${className}`} data-shine={style} data-text={text}>{text}</span>;
}
