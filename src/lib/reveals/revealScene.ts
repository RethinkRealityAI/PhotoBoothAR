/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * revealScene — the pure half of the Beamy reveal page (RevealExperience):
 *
 *   revealLayout   where Beamy stands, how tall he is, where the sealed object
 *                  (then the news card) sits, where his speech bubble points,
 *                  and the geometry of the ring / triangle drawn round him;
 *                  for a phone, a wide screen and the email poster still
 *   revealReducer  the phase machine: arriving → sealed → opening → revealed,
 *                  and which of Beamy's four lines he is saying
 *   lineText       that line as words ({left} filled for the tap unlock)
 *   demoDoc        /reveal/demo/:occasion with ?unlock= / ?theme= overrides
 *
 * No React, no DOM: the page feeds viewport sizes and events in, and reads
 * rectangles and states out.
 */
import { fillLine, presetDoc, REVEAL_OCCASIONS, REVEAL_THEMES, REVEAL_UNLOCKS, withUnlock, type BeamyLines, type RevealDoc, type RevealOccasion, type RevealTheme, type RevealUnlock } from './revealModel';
import { CHEER_AT } from './revealUnlock';

export type RevealMode = 'live' | 'preview' | 'poster';

export interface Rect { x: number; y: number; w: number; h: number }
export interface BeamySpot { x: number; feet: number; h: number }

export interface BubbleSpot {
  /** The point the tail touches (viewport px). */
  x: number;
  y: number;
  /** 'down' = bubble above the point; 'left' = bubble to the right of the point. */
  tail: 'down' | 'left';
  maxW: number;
}

export interface RingSpot { cx: number; cy: number; r: number }
export interface TriangleSpot { cx: number; cy: number; size: number }

export interface RevealLayout {
  wide: boolean;
  beamy: BeamySpot;
  /** Sealed object (sealed) or the news card (revealed). */
  slot: Rect;
  bubble: BubbleSpot;
  /** Top of the teaser block; null = no teaser (poster, revealed). */
  teaserTop: number | null;
  /** The hint pill + "Just show me" row: centred on x, top y. Null in the poster and once revealed. */
  controls: { x: number; y: number; w: number } | null;
  /** The ring round Beamy (turn dial, hold charge, tap counter). */
  ring: RingSpot;
  /** The triangle the trace unlock asks for (beamyOutline's centroid + height). */
  triangle: TriangleSpot;
  /** Invisible button over his body (viewport px). */
  hit: Rect;
}

export type RevealPhase = 'arriving' | 'sealed' | 'opening' | 'revealed';

/** The ring round Beamy, in his heights. */
export const RING_R = 0.6;
export const RING_CY = 0.48;
/** The trace triangle, in his heights. */
export const TRI_SIZE = 1.2;
export const TRI_CY = 0.38;
/** Top bar (wordmark, replay) height. */
export const BAR_H = 56;
/** Hint pill + "Just show me" row. */
export const CONTROLS_H = 104;
/** Space kept for a two-line speech bubble. */
export const BUBBLE_ROOM = 80;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Wide = two columns (Beamy left, the object right). */
export function isWide(w: number, h: number): boolean {
  return w >= 820 && w >= h * 1.0;
}

/** How far the unlock's ornament reaches above and below his feet, in his heights. */
export function ornamentReach(unlock: RevealUnlock): { top: number; bottom: number; half: number } {
  if (unlock === 'trace') {
    const half = TRI_SIZE / Math.sqrt(3);
    return { top: TRI_CY + (2 / 3) * TRI_SIZE, bottom: Math.max(0, TRI_SIZE / 3 - TRI_CY), half };
  }
  if (usesRing(unlock)) return { top: Math.max(1.02, RING_CY + RING_R), bottom: RING_R - RING_CY, half: RING_R };
  // His arms reach about 0.55 of his height either side of centre.
  return { top: 1.02, bottom: 0, half: 0.55 };
}

/** Unlocks that draw a ring round Beamy. */
export function usesRing(unlock: RevealUnlock): boolean {
  return unlock === 'turn' || unlock === 'tap' || unlock === 'melt' || unlock === 'shine';
}

function finish(wide: boolean, beamy: BeamySpot, slot: Rect, bubble: BubbleSpot, teaserTop: number | null, controls: RevealLayout['controls']): RevealLayout {
  const { x, feet, h } = beamy;
  const hw = h * 0.8;
  return {
    wide,
    beamy,
    slot,
    bubble,
    teaserTop,
    controls,
    ring: { cx: x, cy: feet - RING_CY * h, r: RING_R * h },
    triangle: { cx: x, cy: feet - TRI_CY * h, size: TRI_SIZE * h },
    hit: { x: x - hw / 2, y: feet - h * 1.02, w: hw, h: h * 1.02 },
  };
}

/**
 * The page's geometry for a viewport. Sealed and revealed differ: once open,
 * Beamy steps aside (smaller) and the card takes the room the object had.
 */
export function revealLayout(w: number, h: number, mode: RevealMode, phase: RevealPhase, unlock: RevealUnlock): RevealLayout {
  const W = Math.max(1, w);
  const H = Math.max(1, h);
  const reach = ornamentReach(unlock);
  const open = phase === 'revealed';
  // The dial's knob and the trace's start dot stand proud of the ornament.
  const gap = unlock === 'turn' ? 24 : unlock === 'trace' ? 20 : 12;

  if (mode === 'poster') return posterLayout(W, H, reach);

  const wide = isWide(W, H);
  if (wide) {
    const bh = clamp(H * 0.34, 170, 320);
    const x = clamp(W * 0.3, 200, W * 0.4);
    if (open) {
      const feet = H - 56;
      const cw = Math.min(560, W * 0.46);
      const cx = clamp(W * 0.65, x + bh * 0.5 + cw / 2 + 24, W - cw / 2 - 24);
      const slot = { x: cx - cw / 2, y: BAR_H + 24, w: cw, h: H - BAR_H - 24 - 40 };
      const beamy = { x, feet, h: bh };
      return finish(true, beamy, slot, { x, y: feet - bh * 1.1 - 14, tail: 'down', maxW: 300 }, null, null);
    }
    const controlsTop = H - CONTROLS_H - 12;
    const feet = controlsTop - 14 - reach.bottom * bh;
    const beamy = { x, feet, h: bh };
    const ornTop = feet - reach.top * bh;
    const sw = Math.min(460, W * 0.38);
    const top = BAR_H + 120;
    const sh = clamp(controlsTop - top - 20, 200, 520);
    const cx = clamp(W * 0.66, x + reach.half * bh + sw / 2 + 32, W - sw / 2 - 24);
    const slot = { x: cx - sw / 2, y: top, w: sw, h: sh };
    return finish(true, beamy, slot, { x, y: ornTop - gap, tail: 'down', maxW: 300 }, BAR_H + 16, { x, y: controlsTop, w: Math.min(360, W * 0.36) });
  }

  // Phone / narrow: the object above, Beamy under it, the controls at the foot.
  if (open) {
    const bh = clamp(H * 0.15, 92, 140);
    const x = clamp(W * 0.22, 88, 124);
    const feet = H - 30;
    const cw = Math.min(W - 32, 480);
    const slot = { x: (W - cw) / 2, y: BAR_H + 4, w: cw, h: Math.max(160, feet - bh * 1.04 - 14 - (BAR_H + 4)) };
    const bubbleX = x + bh * 0.5 + 10;
    return finish(false, { x, feet, h: bh }, slot, { x: bubbleX, y: feet - bh * 0.62, tail: 'left', maxW: Math.max(140, W - bubbleX - 16) }, null, null);
  }
  const controlsTop = H - CONTROLS_H - 8;
  const slotTop = BAR_H + 96;
  let bh = clamp(H * 0.23, 120, 210);
  let feet = 0;
  let ornTop = 0;
  let slotBottom = 0;
  for (let i = 0; i < 20; i++) {
    feet = controlsTop - 10 - reach.bottom * bh;
    ornTop = feet - reach.top * bh;
    slotBottom = ornTop - gap - BUBBLE_ROOM - 8;
    if (slotBottom - slotTop >= 190 || bh <= 112) break;
    bh -= 8;
  }
  const sw = Math.min(W - 32, 420);
  const slot = { x: (W - sw) / 2, y: slotTop, w: sw, h: Math.max(120, slotBottom - slotTop) };
  const x = W / 2;
  return finish(false, { x, feet, h: bh }, slot, { x, y: ornTop - gap, tail: 'down', maxW: Math.min(320, W - 24) }, BAR_H + 4, { x, y: controlsTop, w: Math.min(W - 32, 360) });
}

/** The email hero still: Beamy and the sealed object, large, centred, no text. */
function posterLayout(W: number, H: number, reach: { top: number; bottom: number; half: number }): RevealLayout {
  const colOf = (bh: number) => Math.max(1.1, reach.half * 2) * bh;
  if (W >= H) {
    let bh = Math.min(H * 0.58, (H * 0.86) / (reach.top + reach.bottom));
    let sw = H * 0.6;
    let sh = H * 0.68;
    let gap = W * 0.05;
    const total = colOf(bh) + gap + sw;
    const k = Math.min(1, (W * 0.86) / total);
    bh *= k; sw *= k; sh *= k; gap *= k;
    const left = (W - (colOf(bh) + gap + sw)) / 2;
    const x = left + colOf(bh) / 2;
    const feet = H / 2 + ((reach.top - reach.bottom) * bh) / 2;
    const slot = { x: left + colOf(bh) + gap, y: (H - sh) / 2, w: sw, h: sh };
    return finish(true, { x, feet, h: bh }, slot, { x, y: 0, tail: 'down', maxW: 0 }, null, null);
  }
  // Portrait: object on top, Beamy under it.
  const bh = Math.min(H * 0.3, (W * 0.9) / Math.max(1.1, reach.half * 2));
  const sw = Math.min(W * 0.8, H * 0.4);
  const sh = H * 0.4;
  const colH = (reach.top + reach.bottom) * bh;
  const gap = H * 0.04;
  const top = (H - (sh + gap + colH)) / 2;
  const slot = { x: (W - sw) / 2, y: top, w: sw, h: sh };
  const feet = top + sh + gap + reach.top * bh;
  return finish(false, { x: W / 2, feet, h: bh }, slot, { x: W / 2, y: 0, tail: 'down', maxW: 0 }, null, null);
}

/* ------------------------------------------------------------------ */
/* Phase machine                                                       */
/* ------------------------------------------------------------------ */

export type LineKey = keyof BeamyLines | 'none';

export interface RevealState {
  phase: RevealPhase;
  line: LineKey;
  /** Has he said the cheer line yet (once per run). */
  cheered: boolean;
  /** 0..1, the unlock's own progress. */
  progress: number;
  /** Bumps every restart (keys effects and canvases). */
  run: number;
  /** How it opened: the gesture, "Just show me", or the editor's jump. */
  openedBy: 'gesture' | 'skip' | 'jump' | null;
}

export type RevealEvent =
  | { type: 'arrived' }
  | { type: 'hint' }
  | { type: 'progress'; value: number }
  | { type: 'open'; by: 'gesture' | 'skip' }
  | { type: 'opened' }
  | { type: 'jump' }
  | { type: 'restart' };

export function initialRevealState(run = 0, poster = false): RevealState {
  return { phase: poster ? 'sealed' : 'arriving', line: 'none', cheered: false, progress: 0, run, openedBy: null };
}

export function revealReducer(s: RevealState, e: RevealEvent): RevealState {
  switch (e.type) {
    case 'arrived':
      return s.phase === 'arriving' ? { ...s, phase: 'sealed', line: 'greeting' } : s;
    case 'hint':
      return s.phase === 'sealed' && s.line === 'greeting' ? { ...s, line: 'hint' } : s;
    case 'progress': {
      if (s.phase !== 'sealed' && s.phase !== 'arriving') return s;
      const value = Number.isFinite(e.value) ? clamp(e.value, 0, 1) : 0;
      if (value >= 1) return { ...s, phase: 'opening', line: 'unlocked', progress: 1, openedBy: 'gesture', cheered: true };
      const phase: RevealPhase = s.phase === 'arriving' ? 'sealed' : s.phase;
      if (value >= CHEER_AT && !s.cheered) return { ...s, phase, progress: value, line: 'cheer', cheered: true };
      const line: LineKey = value > 0 && (s.line === 'greeting' || s.line === 'none') ? 'hint' : s.line;
      return value === s.progress && line === s.line && phase === s.phase ? s : { ...s, phase, progress: value, line };
    }
    case 'open':
      if (s.phase === 'opening' || s.phase === 'revealed') return s;
      return { ...s, phase: 'opening', line: 'unlocked', progress: 1, openedBy: e.by };
    case 'opened':
      return s.phase === 'opening' ? { ...s, phase: 'revealed' } : s;
    case 'jump':
      return { ...s, phase: 'revealed', line: 'unlocked', progress: 1, openedBy: 'jump' };
    case 'restart':
      return initialRevealState(s.run + 1);
  }
}

/** What Beamy says for a line key. `left` = taps still to go (tap unlock). */
export function lineText(key: LineKey, lines: BeamyLines, left: number): string {
  if (key === 'none') return '';
  if (key === 'cheer') return fillLine(lines.cheer, left);
  return lines[key];
}

/** Greeting stays this long before the hint takes over. */
export const GREETING_MS = 2600;
/** From "open" to the card being up (frost falls, the crystal shatters). */
export const OPENING_MS = 900;
export const OPENING_MS_REDUCED = 160;
/** The poster marks itself ready this long after Beamy is standing. */
export const POSTER_SETTLE_MS = 350;

/* ------------------------------------------------------------------ */
/* Demo route                                                          */
/* ------------------------------------------------------------------ */

function pickFrom<T extends string>(list: readonly T[], v: string | null): T | null {
  return v !== null && (list as readonly string[]).includes(v) ? v as T : null;
}

/** /reveal/demo/:occasion — the preset, with ?unlock= and ?theme= overrides (unknown values ignored). */
export function demoDoc(occasion: string | undefined, search: string): RevealDoc {
  const q = new URLSearchParams(search);
  const occ: RevealOccasion = pickFrom(REVEAL_OCCASIONS, occasion ?? null) ?? 'feature-drop';
  let doc = presetDoc(occ);
  const unlock = pickFrom<RevealUnlock>(REVEAL_UNLOCKS, q.get('unlock'));
  if (unlock !== null) doc = withUnlock(doc, unlock);
  const theme = pickFrom<RevealTheme>(REVEAL_THEMES, q.get('theme'));
  if (theme !== null) doc = { ...doc, theme };
  return doc;
}

/** ?poster=1 (or poster=true / bare ?poster). */
export function isPosterQuery(search: string): boolean {
  const q = new URLSearchParams(search);
  if (!q.has('poster')) return false;
  const v = q.get('poster');
  return v === '' || v === '1' || v === 'true';
}

/** The editor only restarts the experience when what it IS changed, not its words. */
export function needsRestart(a: RevealDoc, b: RevealDoc): boolean {
  return a.unlock !== b.unlock || a.theme !== b.theme || a.occasion !== b.occasion || (a.unlock === 'tap' && a.taps !== b.taps);
}
