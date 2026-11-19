/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Ambient decor for the homepage hero, as pure math (components/beamy/
 * AmbientFx draws it): soft snow while Beamy wears a Christmas look, slow
 * twinkling glints while he wears a party one. Low counts that scale with
 * the box, nothing under reduced motion.
 */

export type AmbientKind = 'snow' | 'glint';

/** The hero looks that snow (lib/beamyAssets heroLooks ids); every other look glints. */
export const SNOW_LOOKS: readonly string[] = ['holiday', 'elf', 'tree', 'antlers'];

export function ambientFor(lookId: string | undefined): AmbientKind {
  return lookId !== undefined && SNOW_LOOKS.includes(lookId) ? 'snow' : 'glint';
}

/** How many motes for a box of w x h CSS px: about one per 16k px² of snow, a third as many glints. */
export function ambientCount(kind: AmbientKind, w: number, h: number, reduced: boolean): number {
  if (reduced || !(w > 0) || !(h > 0)) return 0;
  const area = w * h;
  return kind === 'snow'
    ? Math.round(Math.min(48, Math.max(14, area / 16000)))
    : Math.round(Math.min(18, Math.max(6, area / 48000)));
}

export type Mote = { x: number; y: number; r: number; vx: number; vy: number; phase: number };

/** Motes scattered over the box (rand: a seeded 0..1 source, so tests are exact). */
export function seedMotes(kind: AmbientKind, n: number, w: number, h: number, rand: () => number): Mote[] {
  return Array.from({ length: n }, () => {
    const r = kind === 'snow' ? 1.2 + rand() * 2.4 : 3 + rand() * 4;
    return {
      x: rand() * w,
      y: rand() * h,
      r,
      // Snow falls 14-40 px/s (bigger is nearer, so faster) and drifts; glints hold still.
      vx: kind === 'snow' ? (rand() - 0.5) * 10 : 0,
      vy: kind === 'snow' ? 10 + r * 8 + rand() * 6 : 0,
      phase: rand() * Math.PI * 2,
    };
  });
}

/** Advance by dt seconds; snow that leaves the box re-enters on the far side. Mutates in place. */
export function stepMotes(kind: AmbientKind, motes: Mote[], dt: number, w: number, h: number, t: number): void {
  if (kind !== 'snow') return;
  const d = Math.min(Math.max(dt, 0), 0.1);
  for (const m of motes) {
    m.x += (m.vx + Math.sin(t * 0.6 + m.phase) * 6) * d;
    m.y += m.vy * d;
    if (m.y - m.r > h) m.y -= h + m.r * 2;
    if (m.x < -m.r) m.x += w + m.r * 2;
    else if (m.x > w + m.r) m.x -= w + m.r * 2;
  }
}

/** A mote's opacity at time t (s): snow is steady and soft, a glint twinkles in and out. */
export function moteAlpha(kind: AmbientKind, m: Mote, t: number): number {
  if (kind === 'snow') return 0.35 + Math.min(0.4, m.r * 0.1);
  const s = Math.sin(t * 1.4 + m.phase);
  return s > 0 ? s * s * 0.9 : 0;
}
