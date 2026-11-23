/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * initialsTrace — "trace their initials to open".
 *
 * A host can ask the recipient to open the card by tracing their own
 * initials, drawn large over the closed gate in the design's own lettering
 * (gilded, neon, frosted, foil, ribbon, marquee bulbs, pearls). Everything
 * here is pure and in the 900x1600 stage space the opener draws in.
 *
 * The letters are single-stroke skeletons (one pen line per stroke, the way
 * you would write them with a finger), authored as SVG paths in a box 100
 * units tall. Progress is COVERAGE, like traceOpen: every stroke is cut into
 * equal-length bins, a bin lights when the finger passes close to it, order
 * and direction do not matter, and a short jump along the same stroke fills
 * the gap (a fast finger skips bins between pointer events). A jump between
 * strokes never fills anything, so scribbling across the letters does not
 * open them.
 */
import type { CardDesignId } from './cardDesigns';

export interface StagePoint {
  x: number;
  y: number;
}

/* ------------------------------------------------------------------ */
/* The alphabet                                                        */
/* ------------------------------------------------------------------ */

interface Glyph {
  /** Advance width in the 100-tall box. */
  w: number;
  /** One SVG path per pen stroke: absolute M, L, Q, C only. */
  strokes: readonly string[];
}

/** Capital skeletons, written the way a finger would draw them. */
export const GLYPHS: Readonly<Record<string, Glyph>> = {
  A: { w: 72, strokes: ['M2 100 L36 0 L70 100', 'M15 64 L57 64'] },
  B: { w: 66, strokes: ['M8 100 L8 0', 'M8 0 L38 0 C62 0 62 48 38 48 L8 48', 'M8 48 L42 48 C68 48 68 100 42 100 L8 100'] },
  C: { w: 72, strokes: ['M68 20 C58 -6 6 -8 4 50 C2 108 58 106 68 80'] },
  D: { w: 72, strokes: ['M8 0 L8 100', 'M8 0 L30 0 C82 0 82 100 30 100 L8 100'] },
  E: { w: 62, strokes: ['M58 0 L8 0 L8 100 L58 100', 'M8 50 L48 50'] },
  F: { w: 60, strokes: ['M58 0 L8 0 L8 100', 'M8 50 L48 50'] },
  G: { w: 76, strokes: ['M68 20 C58 -6 6 -8 4 50 C2 108 66 108 72 66 L72 54 L44 54'] },
  H: { w: 72, strokes: ['M8 0 L8 100', 'M64 0 L64 100', 'M8 50 L64 50'] },
  I: { w: 56, strokes: ['M28 0 L28 100', 'M10 0 L46 0', 'M10 100 L46 100'] },
  J: { w: 64, strokes: ['M56 0 L56 68 C56 108 8 108 6 74'] },
  K: { w: 68, strokes: ['M8 0 L8 100', 'M62 0 L8 62', 'M26 42 L64 100'] },
  L: { w: 60, strokes: ['M8 0 L8 100 L58 100'] },
  M: { w: 82, strokes: ['M4 100 L10 0 L41 72 L72 0 L78 100'] },
  N: { w: 72, strokes: ['M8 100 L8 0 L64 100 L64 0'] },
  O: { w: 80, strokes: ['M40 0 C-10 0 -10 100 40 100 C90 100 90 0 40 0'] },
  P: { w: 64, strokes: ['M8 100 L8 0', 'M8 0 L38 0 C66 0 66 52 38 52 L8 52'] },
  Q: { w: 82, strokes: ['M40 0 C-10 0 -10 100 40 100 C90 100 90 0 40 0', 'M50 72 L78 104'] },
  R: { w: 68, strokes: ['M8 100 L8 0', 'M8 0 L38 0 C66 0 66 52 38 52 L8 52', 'M34 52 L64 100'] },
  S: { w: 68, strokes: ['M62 16 C52 -4 8 -4 8 24 C8 52 62 46 62 76 C62 106 12 106 4 84'] },
  T: { w: 72, strokes: ['M4 0 L68 0', 'M36 0 L36 100'] },
  U: { w: 72, strokes: ['M8 0 L8 64 C8 108 64 108 64 64 L64 0'] },
  V: { w: 72, strokes: ['M2 0 L36 100 L70 0'] },
  W: { w: 84, strokes: ['M2 0 L21 100 L42 30 L63 100 L82 0'] },
  X: { w: 70, strokes: ['M6 0 L64 100', 'M64 0 L6 100'] },
  Y: { w: 72, strokes: ['M4 0 L36 50 L68 0', 'M36 50 L36 100'] },
  Z: { w: 72, strokes: ['M8 0 L64 0 L8 100 L66 100'] },
};

/**
 * The recipient's initials: the first letter of their first and last names,
 * accents stripped ("Émile Zoë" → "EZ"), capitals only. Null when there is
 * nothing traceable (no name, or a script these letters do not cover); the
 * opener then falls back to the design's own gesture.
 */
export function initialsOf(name: string | null | undefined, max = 2): string | null {
  if (typeof name !== 'string') return null;
  const words = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[\s\-_.]+/)
    .map((w) => w.replace(/[^A-Z]/g, ''))
    .filter(Boolean);
  if (!words.length) return null;
  const picks = words.length === 1 || max < 2 ? [words[0]] : [words[0], words[words.length - 1]];
  const out = picks.map((w) => w[0]).join('');
  return out || null;
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

/** Where the letters sit: centred on the gateway. */
export const INITIALS_CENTER: StagePoint = { x: 450, y: 760 };
/** Spacing between bins along a stroke (stage units). */
export const INITIALS_BIN_STEP = 16;
/** How close the finger must pass to a bin to light it. */
export const INITIALS_TOLERANCE = 64;
/** Share of all bins that opens it. */
export const INITIALS_COMPLETE = 0.82;
/** Largest jump between two lit bins on the same stroke that fills the gap. */
const MAX_GAP_BINS = 6;

export interface InitialsLayout {
  letters: string;
  /** Scale from the 100-tall glyph box to stage units. */
  k: number;
  /** Per letter: its offset in stage space. */
  placed: Array<{ ch: string; x: number; y: number }>;
  /** Every stroke as a stage-space path (for drawing) and its bins (for tracing). */
  strokes: Array<{ d: string; bins: StagePoint[] }>;
}

function num(n: number): string {
  return String(Math.round(n * 10) / 10 + 0);
}

/** Parse one glyph path (absolute M/L/Q/C) into a dense polyline. */
function densePolyline(d: string, steps = 24): StagePoint[] {
  const tok = d.match(/[MLQC]|-?\d*\.?\d+/g) ?? [];
  const pts: StagePoint[] = [];
  let i = 0;
  let cur: StagePoint = { x: 0, y: 0 };
  let cmd = '';
  const n = () => Number(tok[i++]);
  while (i < tok.length) {
    if (/[MLQC]/.test(tok[i])) cmd = tok[i++];
    if (cmd === 'M') {
      cur = { x: n(), y: n() };
      pts.push(cur);
    } else if (cmd === 'L') {
      const p = { x: n(), y: n() };
      for (let s = 1; s <= steps; s++) pts.push({ x: cur.x + ((p.x - cur.x) * s) / steps, y: cur.y + ((p.y - cur.y) * s) / steps });
      cur = p;
    } else if (cmd === 'Q') {
      const c = { x: n(), y: n() };
      const p = { x: n(), y: n() };
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const u = 1 - t;
        pts.push({ x: u * u * cur.x + 2 * u * t * c.x + t * t * p.x, y: u * u * cur.y + 2 * u * t * c.y + t * t * p.y });
      }
      cur = p;
    } else if (cmd === 'C') {
      const a = { x: n(), y: n() };
      const b = { x: n(), y: n() };
      const p = { x: n(), y: n() };
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const u = 1 - t;
        pts.push({
          x: u * u * u * cur.x + 3 * u * u * t * a.x + 3 * u * t * t * b.x + t * t * t * p.x,
          y: u * u * u * cur.y + 3 * u * u * t * a.y + 3 * u * t * t * b.y + t * t * t * p.y,
        });
      }
      cur = p;
    } else {
      break; // unknown command: stop rather than loop
    }
  }
  return pts;
}

/** Equal-spacing resample of a polyline (keeps both ends). */
function resample(pts: StagePoint[], step: number): StagePoint[] {
  if (pts.length < 2) return pts.slice();
  const out: StagePoint[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    let pos = step - carry;
    while (pos <= seg) {
      const t = pos / seg;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      pos += step;
    }
    carry = seg - (pos - step);
  }
  const last = pts[pts.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last.x - tail.x, last.y - tail.y) > step * 0.35) out.push(last);
  return out;
}

/** Transform a glyph path's numbers into stage space. */
function placePath(d: string, ox: number, oy: number, k: number): string {
  let i = 0;
  return d.replace(/-?\d*\.?\d+/g, (m) => {
    const v = Number(m);
    const isX = i++ % 2 === 0;
    return num(isX ? ox + v * k : oy + v * k);
  });
}

/** Lay the letters out, centred on the gateway; null for nothing traceable. */
export function initialsLayout(letters: string | null): InitialsLayout | null {
  if (!letters) return null;
  const chars = [...letters].filter((c) => GLYPHS[c]).slice(0, 2);
  if (!chars.length) return null;
  const height = chars.length === 1 ? 380 : 330;
  const k = height / 100;
  const gap = 0.26 * 100;
  const widthUnits = chars.reduce((s, c) => s + GLYPHS[c].w, 0) + gap * (chars.length - 1);
  // Never wider than the safe middle of a phone (the stage is cropped at the sides).
  const kk = Math.min(k, 560 / widthUnits);
  const total = widthUnits * kk;
  let x = INITIALS_CENTER.x - total / 2;
  const y = INITIALS_CENTER.y - (100 * kk) / 2;
  const placed: InitialsLayout['placed'] = [];
  const strokes: InitialsLayout['strokes'] = [];
  for (const ch of chars) {
    const g = GLYPHS[ch];
    placed.push({ ch, x, y });
    for (const s of g.strokes) {
      const d = placePath(s, x, y, kk);
      strokes.push({ d, bins: resample(densePolyline(d), INITIALS_BIN_STEP) });
    }
    x += (g.w + gap) * kk;
  }
  return { letters: chars.join(''), k: kk, placed, strokes };
}

/* ------------------------------------------------------------------ */
/* Tracing                                                             */
/* ------------------------------------------------------------------ */

export interface InitialsTrace {
  /** covered[stroke][bin] */
  covered: boolean[][];
  /** The last lit bin, while the finger is down. */
  last: { s: number; b: number } | null;
}

export function newInitialsTrace(layout: InitialsLayout): InitialsTrace {
  return { covered: layout.strokes.map((s) => s.bins.map(() => false)), last: null };
}

/** The nearest bin to p within tolerance, or null. */
function nearestBin(layout: InitialsLayout, p: StagePoint): { s: number; b: number } | null {
  let best: { s: number; b: number } | null = null;
  let bestD = INITIALS_TOLERANCE;
  layout.strokes.forEach((st, s) => {
    st.bins.forEach((q, b) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d <= bestD) {
        bestD = d;
        best = { s, b };
      }
    });
  });
  return best;
}

/** One pointer sample. Returns the same object when nothing changed. */
export function initialsStep(state: InitialsTrace, layout: InitialsLayout, p: StagePoint): InitialsTrace {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return state;
  const hit = nearestBin(layout, p);
  if (!hit) return state.last ? { ...state, last: null } : state;
  const covered = state.covered.map((row) => row.slice());
  let changed = !covered[hit.s][hit.b];
  covered[hit.s][hit.b] = true;
  const prev = state.last;
  if (prev && prev.s === hit.s && Math.abs(prev.b - hit.b) <= MAX_GAP_BINS) {
    const [a, b] = prev.b < hit.b ? [prev.b, hit.b] : [hit.b, prev.b];
    for (let i = a; i <= b; i++) {
      if (!covered[hit.s][i]) changed = true;
      covered[hit.s][i] = true;
    }
  }
  const moved = !prev || prev.s !== hit.s || prev.b !== hit.b;
  if (!changed && !moved) return state;
  return { covered, last: hit };
}

/** The finger lifted: the next touch starts a fresh run (no gap fill across lifts). */
export function initialsLift(state: InitialsTrace): InitialsTrace {
  return state.last ? { ...state, last: null } : state;
}

export function initialsProgress(state: InitialsTrace): number {
  let lit = 0;
  let all = 0;
  for (const row of state.covered) {
    for (const c of row) {
      all++;
      if (c) lit++;
    }
  }
  return all ? lit / all : 0;
}

export function initialsComplete(state: InitialsTrace): boolean {
  return initialsProgress(state) >= INITIALS_COMPLETE;
}

/** The lit runs as one SVG path (consecutive lit bins joined, per stroke). */
export function initialsLitPath(layout: InitialsLayout, state: InitialsTrace): string {
  let d = '';
  layout.strokes.forEach((st, s) => {
    let run = false;
    st.bins.forEach((q, b) => {
      if (state.covered[s]?.[b]) {
        d += `${run ? 'L' : 'M'}${num(q.x)} ${num(q.y)} `;
        run = true;
      } else run = false;
    });
  });
  return d.trim();
}

/* ------------------------------------------------------------------ */
/* Lettering: each design writes the initials in its own hand          */
/* ------------------------------------------------------------------ */

export type LetterStyle = 'gilt' | 'foil' | 'neon' | 'frost' | 'ribbon' | 'bulbs' | 'pearls';
export const LETTER_STYLES: readonly LetterStyle[] = ['gilt', 'foil', 'neon', 'frost', 'ribbon', 'bulbs', 'pearls'];

export const DESIGN_LETTERING: Readonly<Record<CardDesignId, LetterStyle>> = {
  'garden-gate': 'ribbon',
  'balloon-bash': 'foil',
  'gala-night': 'gilt',
  owambe: 'gilt',
  'city-lights': 'neon',
  'moon-gate': 'gilt',
  'cloud-nine': 'foil',
  'grand-hall': 'gilt',
  'island-sunset': 'ribbon',
  'love-notes': 'ribbon',
  'festival-of-lights': 'neon',
  'crescent-night': 'gilt',
  'golden-hour': 'gilt',
  'jungle-party': 'foil',
  'winter-glow': 'frost',
  'balloon-release': 'foil',
  showtime: 'bulbs',
  'pop-party': 'foil',
  'jewel-box': 'gilt',
  'deep-blue': 'pearls',
};
