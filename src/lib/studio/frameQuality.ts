/**
 * frameQuality — is a generated, keyed frame actually USABLE in the booth?
 *
 * The keyer's own honesty gate (MIN_KEYED_FRACTION) only proves SOME green
 * was removed. It cannot see the failures hosts actually hit:
 *   • the model painted a face (or a person) inside the window — it then sits
 *     over every guest's own face;
 *   • the window was filled black or with a grey checkerboard ("transparent"
 *     as an image model understands it), so nothing keyed out where it matters;
 *   • ornament crept into the middle, or the cut-out landed in the wrong place;
 *   • the keyer ate small patches of the art itself (stray holes the guest's
 *     photo shows through).
 *
 * PURE and DOM-free: operates on a downsampled ALPHA mask of the fitted
 * 1080×1920 result (one cell per CELL×CELL pixels), so it is cheap (~32k
 * cells) and unit-tested with synthetic masks. Geometry expectations come
 * from FRAME_GEOMETRY in assetPrompt.ts — the same numbers the prompt states
 * and the preview outlines, so "what we asked for" and "what we check" are
 * one table.
 *
 * Every reason carries a stable machine `code` plus a host-readable
 * `message`. Stray holes are REPAIRED (source pixels restored, or a flat
 * green speck filled from its surroundings) rather than failed: they are a
 * keying artefact, not a design failure.
 */
import { FRAME_GEOMETRY, BOOTH_SAFE_ZONE, type FrameLayout } from '../assetPrompt';
import {
  FRAME_H,
  FRAME_W,
  fitOnCanvas,
  hasGenuineAlpha,
  needsChromaKey,
  processFrameImage,
  type KeyOutOptions,
  type RgbaImage,
} from './chromaKey';

/** Mask cell size in px. 8 → a 135×240 grid for 1080×1920. */
export const CELL = 8;

/* ── Thresholds (each one's derivation is in the comment beside it) ─────── */

/** |(w/h)/(9/16) − 1| at/under which the source counts as 9:16. Gemini 2.5's
 *  9:16 output is 768×1344 (0.5714, +1.6%); 3% leaves room for that and
 *  rejects 2:3 (0.667, +18.5%). Over FAIL it is a different shape entirely. */
export const ASPECT_TOLERANCE = 0.03;
export const ASPECT_FAIL = 0.15;
/** A cell is "clear" when its mean alpha is under this (25% opacity). */
const CLEAR_ALPHA = 64;
/** Classic border: share of the FACE ZONE that must be clear. The face zone is
 *  where a guest's face actually lands in the booth, so 3% of art there is a
 *  sparkle at most; more is ornament on the guest. */
export const FACE_ZONE = { x0: 0.22, y0: 0.2, x1: 0.78, y1: 0.62 } as const;
export const FACE_ZONE_CLEAR_MIN = 0.97;
/** Classic border: share of the border BAND (outside the geometry window)
 *  that must carry art — under this, "a frame" is a few hairlines. */
export const BORDER_COVERAGE_MIN = 0.22;
/** Cut-out window area bounds, as a share of the canvas. The requested
 *  ellipses are 5.6% (full-scene) and 3.7% each (duo); the bounds allow the
 *  model ~2.2× either way before we call it the wrong size. */
export const SCENE_WINDOW_AREA = { min: 0.025, max: 0.15 } as const;
export const DUO_WINDOW_AREA = { min: 0.012, max: 0.1 } as const;
/** How far (canvas fractions) a cut-out's centroid may sit from where it
 *  was asked for. 0.12 ≈ 130 px horizontally — a visibly different place. */
export const WINDOW_CENTRE_TOLERANCE = 0.12;
/** Opaque island inside a window big enough to be a face/person: ≥1% of the
 *  canvas (a 100×200 px blob) or ≥8% of its window. Sparkles stay under. */
export const FACE_ISLAND_CANVAS = 0.01;
export const FACE_ISLAND_WINDOW = 0.08;
/** A clear region enclosed by art and smaller than this share of the canvas
 *  is a stray hole (keying artefact), never a design window. */
export const STRAY_HOLE_MAX = 0.005;
/** Hole texture test: source luma std-dev or mean chroma distance above this
 *  means the keyer ate real art → restore the source pixels. Under both, the
 *  hole is a flat green speck → fill it from its surroundings. */
export const HOLE_TEXTURE = 18;
/** Corner overlay: overall clear share, and the centre that must be clear. */
export const CORNER_CLEAR_MIN = 0.6;
export const CORNER_CENTRE = { x0: 0.25, y0: 0.3, x1: 0.75, y1: 0.7 } as const;
/** Lower-third: the top share that must be clear. */
export const BOTTOM_TOP_CLEAR_MIN = 0.95;
/** Full-bleed scene: if more than this is clear, it is a border, not a scene. */
export const SCENE_MAX_CLEAR = 0.4;
/** Share of the art (opaque cells) that must be visible between the booth's
 *  chrome bands — otherwise guests see the design only in the finished photo. */
export const VISIBLE_ART_MIN = 0.15;
/** Green spill: share of visible pixels whose green leads max(R,B) by 40+. */
export const GREEN_SPILL_MAX = 0.004;

export type QualityCode =
  | 'aspect'
  | 'unkeyed'
  | 'window_painted'
  | 'art_in_window'
  | 'border_thin'
  | 'no_window'
  | 'window_count'
  | 'window_misplaced'
  | 'window_size'
  | 'face_in_window'
  | 'not_full_scene'
  | 'hidden_by_controls'
  | 'green_spill';

export interface QualityReason {
  code: QualityCode;
  severity: 'fail' | 'warn';
  /** Host-readable — no jargon. */
  message: string;
}

export interface QualityResult {
  /** true when no FAIL-severity reason was found. */
  ok: boolean;
  /** 0..1 — 1 is clean. Fails cost 0.4, warnings 0.1. */
  score: number;
  reasons: QualityReason[];
  /** The fitted image with stray holes repaired, when any were. */
  repaired?: RgbaImage;
  /** Number of stray holes repaired. */
  repairedHoles: number;
}

export interface QualityInput {
  /** Keyed + contain-fit result (normally 1080×1920). */
  fitted: RgbaImage;
  layout: FrameLayout;
  /** The provider's raw dimensions (before the fit). */
  source: { width: number; height: number };
  /** The UNKEYED source, contain-fit to the same canvas — enables repair. */
  original?: RgbaImage;
  /** The key colour used (for the flat-speck test). */
  keyColor?: readonly [number, number, number];
}

/* ── Mask ─────────────────────────────────────────────────────────────── */

export interface Mask {
  w: number;
  h: number;
  /** 1 = clear cell, 0 = art. */
  clear: Uint8Array;
}

/** Downsample alpha into a clear/art cell mask (mean alpha per cell). */
export function alphaMask(img: RgbaImage, cell = CELL): Mask {
  const w = Math.ceil(img.width / cell);
  const h = Math.ceil(img.height / cell);
  const sum = new Float64Array(w * h);
  const cnt = new Uint32Array(w * h);
  for (let y = 0; y < img.height; y++) {
    const cy = Math.floor(y / cell) * w;
    for (let x = 0; x < img.width; x++) {
      const c = cy + Math.floor(x / cell);
      sum[c] += img.data[(y * img.width + x) * 4 + 3];
      cnt[c]++;
    }
  }
  const clear = new Uint8Array(w * h);
  for (let i = 0; i < clear.length; i++) clear[i] = cnt[i] > 0 && sum[i] / cnt[i] < CLEAR_ALPHA ? 1 : 0;
  return { w, h, clear };
}

export interface Component {
  id: number;
  cells: number[];
  /** Fraction of the mask. */
  area: number;
  cx: number;
  cy: number;
  touchesEdge: boolean;
}

/** 4-connected components of cells where mask.clear === value. */
export function components(mask: Mask, value: 0 | 1): { comps: Component[]; label: Int32Array } {
  const { w, h, clear } = mask;
  const label = new Int32Array(w * h).fill(-1);
  const comps: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (clear[start] !== value || label[start] !== -1) continue;
    const id = comps.length;
    const cells: number[] = [];
    let sx = 0, sy = 0, edge = false;
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      cells.push(p);
      const x = p % w, y = (p - x) / w;
      sx += x; sy += y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) {
        if (q >= 0 && clear[q] === value && label[q] === -1) { label[q] = id; stack.push(q); }
      }
    }
    comps.push({
      id, cells, area: cells.length / (w * h),
      cx: (sx / cells.length + 0.5) / w, cy: (sy / cells.length + 0.5) / h, touchesEdge: edge,
    });
  }
  return { comps, label };
}

/** Clear share of a canvas-fraction box. */
export function clearShare(mask: Mask, box: { x0: number; y0: number; x1: number; y1: number }): number {
  const x0 = Math.floor(box.x0 * mask.w), x1 = Math.ceil(box.x1 * mask.w);
  const y0 = Math.floor(box.y0 * mask.h), y1 = Math.ceil(box.y1 * mask.h);
  let n = 0, c = 0;
  for (let y = Math.max(0, y0); y < Math.min(mask.h, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(mask.w, x1); x++) { n++; c += mask.clear[y * mask.w + x]; }
  }
  return n === 0 ? 1 : c / n;
}

/**
 * Art islands fully enclosed by ONE clear component (an island in a lake).
 * Returns, per enclosing clear component id, the islands' cells.
 */
function enclosedIslands(mask: Mask, clearLabel: Int32Array): Map<number, Component[]> {
  const art = components(mask, 0);
  const out = new Map<number, Component[]>();
  const { w } = mask;
  for (const c of art.comps) {
    if (c.touchesEdge) continue;
    let host = -2;
    let enclosed = true;
    for (const p of c.cells) {
      const x = p % w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q < 0 || q >= mask.clear.length || mask.clear[q] !== 1) continue;
        const l = clearLabel[q];
        if (host === -2) host = l;
        else if (host !== l) { enclosed = false; break; }
      }
      if (!enclosed) break;
    }
    if (!enclosed || host < 0) continue;
    const list = out.get(host) ?? [];
    list.push(c);
    out.set(host, list);
  }
  return out;
}

/* ── Painted-window diagnosis (black / checkerboard) ──────────────────── */

/** What fills an art-covered face zone: 'black', 'checker' or 'art'. */
export function diagnoseFill(img: RgbaImage, box: { x0: number; y0: number; x1: number; y1: number }): 'black' | 'checker' | 'art' {
  const x0 = Math.floor(box.x0 * img.width), x1 = Math.floor(box.x1 * img.width);
  const y0 = Math.floor(box.y0 * img.height), y1 = Math.floor(box.y1 * img.height);
  let n = 0, dark = 0, grey = 0, light = 0, mid = 0;
  for (let y = y0; y < y1; y += 3) {
    for (let x = x0; x < x1; x += 3) {
      const i = (y * img.width + x) * 4;
      if (img.data[i + 3] < CLEAR_ALPHA) continue;
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      n++;
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      if (luma < 40) dark++;
      if (Math.max(r, g, b) - Math.min(r, g, b) < 14) {
        grey++;
        if (luma > 225) light++;
        else if (luma > 140) mid++;
      }
    }
  }
  if (n === 0) return 'art';
  if (dark / n > 0.85) return 'black';
  // A painted checkerboard: almost entirely neutral, split between white and
  // light grey squares.
  if (grey / n > 0.9 && light / n > 0.2 && mid / n > 0.2) return 'checker';
  return 'art';
}

/* ── Repair ───────────────────────────────────────────────────────────── */

function repairHoles(
  fitted: RgbaImage,
  original: RgbaImage,
  holes: Component[],
  mask: Mask,
  key: readonly [number, number, number],
): RgbaImage {
  const out = new Uint8ClampedArray(fitted.data);
  const W = fitted.width;
  for (const hole of holes) {
    const pixels: number[] = [];
    for (const c of hole.cells) {
      const cx = c % mask.w, cy = (c - cx) / mask.w;
      for (let y = cy * CELL; y < Math.min(fitted.height, (cy + 1) * CELL); y++) {
        for (let x = cx * CELL; x < Math.min(W, (cx + 1) * CELL); x++) {
          const p = y * W + x;
          if (fitted.data[p * 4 + 3] < 255) pixels.push(p);
        }
      }
    }
    if (pixels.length === 0) continue;
    // Texture test over the ORIGINAL pixels of the hole.
    let sl = 0, sl2 = 0, sd = 0;
    for (const p of pixels) {
      const i = p * 4;
      const r = original.data[i], g = original.data[i + 1], b = original.data[i + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      sl += l; sl2 += l * l;
      sd += Math.hypot(r - key[0], g - key[1], b - key[2]) / Math.sqrt(3);
    }
    const n = pixels.length;
    const std = Math.sqrt(Math.max(0, sl2 / n - (sl / n) ** 2));
    const textured = std > HOLE_TEXTURE || sd / n > HOLE_TEXTURE;
    let fill: [number, number, number] | null = null;
    if (!textured) {
      // Flat green speck: fill from the surrounding art (cells around the hole).
      let fr = 0, fg = 0, fb = 0, fn = 0;
      const inHole = new Set(hole.cells);
      for (const c of hole.cells) {
        const cx = c % mask.w;
        for (const q of [cx > 0 ? c - 1 : -1, cx < mask.w - 1 ? c + 1 : -1, c - mask.w, c + mask.w]) {
          if (q < 0 || q >= mask.clear.length || inHole.has(q) || mask.clear[q] === 1) continue;
          const qx = q % mask.w, qy = (q - qx) / mask.w;
          const i = ((qy * CELL + (CELL >> 1)) * W + qx * CELL + (CELL >> 1)) * 4;
          if (i + 3 < fitted.data.length && fitted.data[i + 3] > 0) {
            fr += fitted.data[i]; fg += fitted.data[i + 1]; fb += fitted.data[i + 2]; fn++;
          }
        }
      }
      if (fn === 0) continue;
      fill = [fr / fn, fg / fn, fb / fn];
    }
    for (const p of pixels) {
      const i = p * 4;
      const r = fill ? fill[0] : original.data[i];
      const g = fill ? fill[1] : original.data[i + 1];
      const b = fill ? fill[2] : original.data[i + 2];
      out[i] = r; out[i + 2] = b;
      out[i + 1] = Math.min(g, Math.max(r, b)); // despill what comes back
      out[i + 3] = 255;
    }
  }
  return { data: out, width: fitted.width, height: fitted.height };
}

/* ── The gate ─────────────────────────────────────────────────────────── */

const MESSAGES: Record<QualityCode, string> = {
  aspect: 'The design came back in a different shape, so it is padded to fit the phone.',
  unkeyed: 'The background did not come out clear, so guests would not show through.',
  window_painted: 'The photo area was painted in instead of left clear.',
  art_in_window: 'Decoration spills into the middle, where guests’ faces go.',
  border_thin: 'The border is very light — it may barely show around the photo.',
  no_window: 'There is no clear opening for a face.',
  window_count: 'The number of face openings is not what was asked for.',
  window_misplaced: 'The face opening is not where faces line up in the booth.',
  window_size: 'The face opening is too small or too large for a face.',
  face_in_window: 'A face or figure was drawn inside the opening — it would cover the guest.',
  not_full_scene: 'This came out as a border rather than a full scene.',
  hidden_by_controls: 'Most of the design sits under the booth buttons on a phone — guests only see it in the photo.',
  green_spill: 'A faint green edge remains around parts of the art.',
};

function reason(code: QualityCode, severity: 'fail' | 'warn', detail?: string): QualityReason {
  return { code, severity, message: detail ? `${MESSAGES[code]} ${detail}` : MESSAGES[code] };
}

export function assessFrame(input: QualityInput): QualityResult {
  const { fitted, layout, source } = input;
  const reasons: QualityReason[] = [];
  const mask = alphaMask(fitted);
  const total = mask.w * mask.h;
  const clearCount = mask.clear.reduce((a, b) => a + b, 0);
  const clearFrac = clearCount / total;

  // Aspect.
  if (source.width > 0 && source.height > 0) {
    const off = Math.abs((source.width / source.height) / (9 / 16) - 1);
    if (off > ASPECT_FAIL) reasons.push(reason('aspect', 'fail'));
    else if (off > ASPECT_TOLERANCE) reasons.push(reason('aspect', 'warn'));
  }

  if (clearFrac < 0.015) {
    reasons.push(reason('unkeyed', 'fail'));
    return finish(reasons, undefined, 0);
  }

  const clear = components(mask, 1);
  const islands = enclosedIslands(mask, clear.label);
  const geometry = FRAME_GEOMETRY[layout];

  // Windows = enclosed clear components that are not stray holes; for the
  // classic border the window is the LARGEST clear component, enclosed or not
  // (contain-fit padding can connect it to the canvas edge).
  const enclosed = clear.comps.filter((c) => !c.touchesEdge);
  const stray = enclosed.filter((c) => c.area < STRAY_HOLE_MAX && !inAnyWindow(c, geometry.windows));
  const windows = enclosed.filter((c) => c.area >= STRAY_HOLE_MAX);

  const faceIslandCheck = (win: Component) => {
    for (const isl of islands.get(win.id) ?? []) {
      if (isl.area >= FACE_ISLAND_CANVAS || isl.area >= FACE_ISLAND_WINDOW * win.area) {
        reasons.push(reason('face_in_window', 'fail'));
        return;
      }
    }
  };

  if (layout === 'classic-border') {
    const share = clearShare(mask, FACE_ZONE);
    if (share < FACE_ZONE_CLEAR_MIN) {
      const fill = diagnoseFill(fitted, FACE_ZONE);
      if (fill === 'black') reasons.push(reason('window_painted', 'fail', 'It came back black.'));
      else if (fill === 'checker') reasons.push(reason('window_painted', 'fail', 'It came back as a grey checkerboard.'));
      else {
        const main = largest(clear.comps);
        const hasIsland = main ? (islands.get(main.id) ?? []).some((i) => i.area >= FACE_ISLAND_CANVAS) : false;
        reasons.push(hasIsland ? reason('face_in_window', 'fail') : reason('art_in_window', 'fail'));
      }
    }
    const w = geometry.windows[0];
    const band = 1 - bandClearShare(mask, { x0: w.cx - w.rx, y0: w.cy - w.ry, x1: w.cx + w.rx, y1: w.cy + w.ry });
    if (band < BORDER_COVERAGE_MIN) reasons.push(reason('border_thin', 'warn'));
  } else if (layout === 'full-scene' || layout === 'duo-scene') {
    const want = geometry.windows;
    const bounds = layout === 'full-scene' ? SCENE_WINDOW_AREA : DUO_WINDOW_AREA;
    if (clearFrac > SCENE_MAX_CLEAR) reasons.push(reason('not_full_scene', 'fail'));
    const sized = windows.filter((c) => c.area >= bounds.min * 0.5);
    if (sized.length === 0) {
      reasons.push(reason('no_window', 'fail'));
    } else if (sized.length !== want.length) {
      reasons.push(reason('window_count', 'fail'));
    } else {
      // Match each requested window to the nearest found one.
      const used = new Set<number>();
      for (const target of want) {
        let best: Component | null = null;
        let bestD = Infinity;
        for (const c of sized) {
          if (used.has(c.id)) continue;
          const d = Math.hypot(c.cx - target.cx, c.cy - target.cy);
          if (d < bestD) { bestD = d; best = c; }
        }
        if (!best) continue;
        used.add(best.id);
        if (bestD > WINDOW_CENTRE_TOLERANCE) reasons.push(reason('window_misplaced', 'fail'));
        else if (best.area < bounds.min || best.area > bounds.max) reasons.push(reason('window_size', 'warn'));
        faceIslandCheck(best);
      }
    }
  } else if (layout === 'corner-overlay') {
    if (clearShare(mask, CORNER_CENTRE) < 0.95 || clearFrac < CORNER_CLEAR_MIN) {
      const fill = diagnoseFill(fitted, CORNER_CENTRE);
      reasons.push(fill === 'art' ? reason('art_in_window', 'fail') : reason('window_painted', 'fail'));
    }
  } else if (layout === 'bottom-third') {
    if (clearShare(mask, { x0: 0, y0: 0, x1: 1, y1: 0.6 }) < BOTTOM_TOP_CLEAR_MIN) {
      const fill = diagnoseFill(fitted, { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.55 });
      reasons.push(fill === 'art' ? reason('art_in_window', 'fail') : reason('window_painted', 'fail'));
    }
  }

  // Visible-while-posing check (warn only — the capture still has the art).
  const artCells = total - clearCount;
  if (artCells > 0) {
    const y0 = Math.floor(BOOTH_SAFE_ZONE.top * mask.h);
    const y1 = Math.ceil((1 - BOOTH_SAFE_ZONE.bottom) * mask.h);
    let visibleArt = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < mask.w; x++) visibleArt += 1 - mask.clear[y * mask.w + x];
    }
    if (visibleArt / artCells < VISIBLE_ART_MIN) reasons.push(reason('hidden_by_controls', 'warn'));
  }

  if (greenSpill(fitted) > GREEN_SPILL_MAX) reasons.push(reason('green_spill', 'warn'));

  // Repair stray holes.
  let repaired: RgbaImage | undefined;
  if (stray.length > 0 && input.original) {
    repaired = repairHoles(fitted, input.original, stray, mask, input.keyColor ?? [0, 255, 0]);
  }
  return finish(reasons, repaired, repaired ? stray.length : 0);
}

function finish(reasons: QualityReason[], repaired: RgbaImage | undefined, repairedHoles: number): QualityResult {
  const score = Math.max(0, 1 - reasons.reduce((s, r) => s + (r.severity === 'fail' ? 0.4 : 0.1), 0));
  return {
    ok: !reasons.some((r) => r.severity === 'fail'),
    score: Math.round(score * 100) / 100,
    reasons,
    ...(repaired ? { repaired } : {}),
    repairedHoles,
  };
}

function largest(comps: Component[]): Component | undefined {
  return comps.reduce<Component | undefined>((a, c) => (!a || c.area > a.area ? c : a), undefined);
}

/** Clear share of the canvas OUTSIDE a box (the border band). */
function bandClearShare(mask: Mask, box: { x0: number; y0: number; x1: number; y1: number }): number {
  const x0 = Math.floor(box.x0 * mask.w), x1 = Math.ceil(box.x1 * mask.w);
  const y0 = Math.floor(box.y0 * mask.h), y1 = Math.ceil(box.y1 * mask.h);
  let n = 0, c = 0;
  for (let y = 0; y < mask.h; y++) {
    for (let x = 0; x < mask.w; x++) {
      if (x >= x0 && x < x1 && y >= y0 && y < y1) continue;
      n++; c += mask.clear[y * mask.w + x];
    }
  }
  return n === 0 ? 1 : c / n;
}

function inAnyWindow(c: Component, windows: readonly { cx: number; cy: number; rx: number; ry: number }[]): boolean {
  // A small hole near a requested window is part of that window's outline
  // (e.g. a gap in a porthole rim), not art eaten by the keyer.
  return windows.some((w) => Math.abs(c.cx - w.cx) <= w.rx * 1.15 && Math.abs(c.cy - w.cy) <= w.ry * 1.15);
}

/** Share of visible (alpha > 0) pixels whose green leads max(R,B) by 40+. */
export function greenSpill(img: RgbaImage): number {
  let n = 0, spill = 0;
  for (let i = 0; i < img.data.length; i += 16) {
    if (img.data[i + 3] === 0) continue;
    n++;
    if (img.data[i + 1] - Math.max(img.data[i], img.data[i + 2]) > 40) spill++;
  }
  return n === 0 ? 0 : spill / n;
}

/* ── Retry policy ─────────────────────────────────────────────────────── */

/** Correction sentence for the ONE automatic retry, most severe first. Codes
 *  absent here are not worth a regeneration. MIRRORED into
 *  supabase/functions/ai-generate-image/frameLayout.ts (FRAME_CORRECTIONS):
 *  the client sends only the CODE, and the server inserts its own sentence
 *  outside the brief fence, so a correction can never carry host text. */
export const CORRECTIONS: readonly (readonly [QualityCode, string])[] = [
  ['face_in_window', 'IMPORTANT CORRECTION: the previous attempt drew a face inside the opening. The opening must be completely empty flat green — no face, no head, no person, no figure.'],
  ['window_painted', 'IMPORTANT CORRECTION: the previous attempt filled the opening with black or a checkerboard. Fill every opening with flat #00FF00 green only.'],
  ['unkeyed', 'IMPORTANT CORRECTION: the previous attempt had no flat green area. Paint the background and every opening with one flat #00FF00 green.'],
  ['not_full_scene', 'IMPORTANT CORRECTION: the previous attempt left most of the canvas empty. The illustration must cover the whole canvas except the openings.'],
  ['no_window', 'IMPORTANT CORRECTION: the previous attempt had no face opening. Leave the exact green ellipse(s) described above.'],
  ['window_count', 'IMPORTANT CORRECTION: the previous attempt had the wrong number of face openings. Leave exactly the openings described above, no more and no fewer.'],
  ['window_misplaced', 'IMPORTANT CORRECTION: the previous attempt put the opening in the wrong place. Centre it exactly at the coordinates given above.'],
  ['art_in_window', 'IMPORTANT CORRECTION: the previous attempt put decoration over the middle. Keep every bit of art out of the central area — it must be flat green.'],
];

/** The correction CODE for a failed result, or null when a retry cannot help. */
export function retryCorrectionCode(result: QualityResult): QualityCode | null {
  if (result.ok) return null;
  const codes = new Set(result.reasons.filter((r) => r.severity === 'fail').map((r) => r.code));
  for (const [code] of CORRECTIONS) if (codes.has(code)) return code;
  return null;
}

/** The correction sentence for a failed result, or null. */
export function retryCorrection(result: QualityResult): string | null {
  const code = retryCorrectionCode(result);
  return code ? CORRECTIONS.find(([c]) => c === code)![1] : null;
}

/** The single automatic retry: only on the FIRST attempt, only when a
 *  correction exists. Never loops. */
export function shouldAutoRetry(result: QualityResult, attempt: number): boolean {
  return attempt === 0 && retryCorrection(result) !== null;
}

/**
 * Re-keying the SAME image can only help when the first key missed the
 * backdrop: a looser key is worth exactly one try. After it, regenerate.
 * Returns the options for that try, or null.
 */
export function rekeyOptions(rekeysSoFar: number): { tolerance: number; softness: number } | null {
  return rekeysSoFar === 0 ? { tolerance: 58, softness: 30 } : null;
}

/* ── Takes, ranking, the one auto-retry, and the waiting copy ─────────────
 * Pure helpers for frameProcessing.runFrameGeneration and the UI, kept here so
 * they are node-tested (frameProcessing reaches supabase). */

export interface TakeLike {
  keyed: boolean;
  quality: QualityResult | null;
}

/** A take a host can place: keyed, and not failed by the gate. */
export function takeUsable(t: TakeLike): boolean {
  return t.keyed && (t.quality?.ok ?? true);
}

/** Usable takes first, then by gate score; ties keep their order. */
export function rankTakes<T extends TakeLike>(takes: readonly T[]): T[] {
  return takes
    .map((t, i) => ({ t, i }))
    .sort((a, b) =>
      Number(takeUsable(b.t)) - Number(takeUsable(a.t)) ||
      (b.t.quality?.score ?? 1) - (a.t.quality?.score ?? 1) ||
      a.i - b.i)
    .map(({ t }) => t);
}

/** The correction code for the one automatic retry, or null (none helps). */
export function autoRetryCode(take: TakeLike): QualityCode | null {
  if (!take.keyed) return 'unkeyed';
  return take.quality ? retryCorrectionCode(take.quality) : null;
}

/** What the host is told while they wait — honest stages, never a fake %. */
export type FrameStage = 'painting' | 'checking' | 'tidying';

export const FRAME_STAGE_COPY: Record<FrameStage, string> = {
  painting: 'Painting your frame…',
  checking: 'Checking it fits the booth…',
  tidying: 'Tidying up the design…',
};

/** Long-wait copy, by whole seconds spent painting. */
export function paintingCopy(seconds: number): string {
  if (seconds < 12) return 'Sketching the layout…';
  if (seconds < 35) return 'Painting the details…';
  if (seconds < 70) return 'Adding the finishing touches…';
  return 'Still painting — detailed scenes can take up to two minutes.';
}

/* ── The whole browser-side step, as ONE pure function ──────────────────
 * Key → fit → gate → repair. Called from the Web Worker (frameKey.worker.ts)
 * and, when a worker is unavailable, from the main thread — the same function
 * either way, so the two paths cannot disagree about a frame. */

export interface PrepareFlags {
  /** config.transparent — an IHDR colour-type probe, not proof. */
  claimsTransparent: boolean;
  /** config.greenScreen — vetoes the transparent short-circuit. */
  fromGreenScreen: boolean;
}

export interface PrepareOptions {
  /** Enables the quality gate (border frames only). */
  layout?: FrameLayout | null;
  /** Re-key overrides (a looser tolerance — see rekeyOptions). */
  keyOpts?: KeyOutOptions;
}

export interface PreparedFrame {
  /** FRAME_W×FRAME_H, repaired when the gate repaired holes. */
  image: RgbaImage;
  /** False → the key missed the backdrop; the image is still green. */
  keyed: boolean;
  alreadyTransparent: boolean;
  keyedFraction: number;
  keyColor: readonly [number, number, number] | null;
  /** Null when no layout was given. */
  quality: QualityResult | null;
}

export function prepareFrame(src: RgbaImage, flags: PrepareFlags, opts: PrepareOptions = {}): PreparedFrame {
  const layout = opts.layout ?? null;
  const source = { width: src.width, height: src.height };
  const alreadyTransparent = hasGenuineAlpha(flags.claimsTransparent, flags.fromGreenScreen, src);
  if (alreadyTransparent) {
    const image = fitOnCanvas(src, FRAME_W, FRAME_H);
    const quality = layout ? assessFrame({ fitted: image, layout, source }) : null;
    return { image, keyed: true, alreadyTransparent, keyedFraction: 0, keyColor: null, quality };
  }
  const p = processFrameImage(src, FRAME_W, FRAME_H, { refineEdges: true, ...(opts.keyOpts ?? {}) });
  const keyed = needsChromaKey(false, p.keyedFraction);
  if (!layout) {
    return { image: p.image, keyed, alreadyTransparent, keyedFraction: p.keyedFraction, keyColor: p.keyColor, quality: null };
  }
  const quality = assessFrame({
    fitted: p.image,
    layout,
    source,
    original: keyed ? fitOnCanvas(src, FRAME_W, FRAME_H) : undefined,
    keyColor: p.keyColor,
  });
  return {
    image: quality.repaired ?? p.image,
    keyed,
    alreadyTransparent,
    keyedFraction: p.keyedFraction,
    keyColor: p.keyColor,
    quality,
  };
}
