/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure helpers for the keepsake card REVEALS (src/components/cards/reveals/).
 * ===========================================================================
 *
 * No React, no DOM, no three.js — node-testable. What lives here is the part
 * of a reveal that has to be RIGHT rather than pretty:
 *
 *   • the choreography tables (when each beat starts, how long it runs), in a
 *     normal and a reduced-motion variant, so a test can hold every reveal to
 *     the contract's 2.5–6 s after the tap (reveals/types.ts) and to "reduced
 *     motion is gentler, never skipped";
 *   • the hand-off rectangle — where the template's cover will appear, so a
 *     reveal's last frame lands on it and the 700 ms cross-fade reads as one
 *     card, not two;
 *   • small deterministic geometry (the seal's burst of light motes, the
 *     photo collage on the 3D card's face, the drag tilt with its clamp) —
 *     deterministic so a replay looks the same and a test can pin it.
 */

/** One beat of a reveal: starts `at` seconds after the tap, runs `dur` s. */
export interface RevealBeat {
  at: number;
  dur: number;
}

/** The contract's bounds on the length of a reveal after the tap (s). */
export const REVEAL_MIN_S = 2.5;
export const REVEAL_MAX_S = 6;

/** When the last beat finishes. */
export function beatsEnd<K extends string>(beats: Readonly<Record<K, RevealBeat>>): number {
  let end = 0;
  for (const b of Object.values<RevealBeat>(beats)) end = Math.max(end, b.at + b.dur);
  return end;
}

// ── Envelope ──────────────────────────────────────────────────────────────

export interface EnvelopeBeats {
  /** The wax seal flares and cracks in two. */
  seal: RevealBeat;
  /** Light surges along the seams before the flaps move. */
  seams: RevealBeat;
  /** The top flap (the one the seal held) swings up and away. */
  topFlap: RevealBeat;
  /** The two side flaps swing out. */
  sideFlaps: RevealBeat;
  /** The bottom flap swings down. */
  bottomFlap: RevealBeat;
  /** The light inside blooms out of the opening. */
  bloom: RevealBeat;
  /** Motes of light drift out of the glow. */
  motes: RevealBeat;
  /** The card condenses out of the glow and grows to the cover's size. */
  card: RevealBeat;
  /** The glow settles to an ambient wash behind the card. */
  calm: RevealBeat;
  /** A held beat on the finished card, then onDone. */
  hold: RevealBeat;
}

const ENVELOPE_NORMAL: EnvelopeBeats = {
  seal: { at: 0, dur: 0.55 },
  seams: { at: 0.05, dur: 0.45 },
  topFlap: { at: 0.35, dur: 1.0 },
  sideFlaps: { at: 0.5, dur: 1.0 },
  bottomFlap: { at: 0.6, dur: 1.0 },
  bloom: { at: 0.3, dur: 1.1 },
  motes: { at: 0.45, dur: 2.2 },
  card: { at: 1.05, dur: 1.55 },
  calm: { at: 2.1, dur: 1.1 },
  hold: { at: 3.2, dur: 0.45 },
};

// Same story, gentler: the flaps turn less far and slower, the card grows
// from nearly full size instead of from a point, fewer motes (the component
// reads `reduced` for amounts and distances).
const ENVELOPE_REDUCED: EnvelopeBeats = {
  seal: { at: 0, dur: 0.6 },
  seams: { at: 0.05, dur: 0.5 },
  topFlap: { at: 0.4, dur: 1.2 },
  sideFlaps: { at: 0.55, dur: 1.2 },
  bottomFlap: { at: 0.65, dur: 1.2 },
  bloom: { at: 0.35, dur: 1.2 },
  motes: { at: 0.5, dur: 2.0 },
  card: { at: 1.2, dur: 1.4 },
  calm: { at: 2.3, dur: 1.0 },
  hold: { at: 3.3, dur: 0.45 },
};

export function envelopeBeats(reducedMotion: boolean): EnvelopeBeats {
  return reducedMotion ? ENVELOPE_REDUCED : ENVELOPE_NORMAL;
}

/** Below this container width the envelope IS the screen (full-bleed). */
export const FULL_BLEED_MAX_W = 640;

export interface EnvelopeStage {
  /** The envelope's rectangle inside the reveal's container. */
  stage: Rect;
  fullBleed: boolean;
  /** Where the four flaps meet (stage-local px) — the seal's centre. */
  meet: { x: number; y: number };
  /** The seal's radius, px. */
  sealR: number;
  /** Where the card ends (container px) — the template cover's rect. */
  card: Rect;
}

/**
 * On a phone the envelope is the whole screen, edge to edge. On anything
 * wider it is a phone-proportioned envelope standing exactly where the
 * template's cover will appear, so the card opens out of its own frame.
 */
export function envelopeStage(vw: number, vh: number): EnvelopeStage {
  const card = handoffCardRect(vw, vh);
  const fullBleed = vw < FULL_BLEED_MAX_W;
  const stage: Rect = fullBleed ? { x: 0, y: 0, w: Math.max(1, vw), h: Math.max(1, vh) } : card;
  const sealR = Math.round(Math.max(30, Math.min(stage.w * 0.15, 60)));
  return {
    stage,
    fullBleed,
    meet: { x: stage.w / 2, y: Math.round(stage.h * 0.5) },
    sealR,
    card,
  };
}

// ── Curtain (grand reveal) ────────────────────────────────────────────────

export interface CurtainBeats {
  /** The seam of light between the doors blazes. */
  blaze: RevealBeat;
  /** The doors swing apart like stage doors. */
  doors: RevealBeat;
  /** The 3D card floats, free to be dragged — "Read your card" ends it early. */
  float: RevealBeat;
  /** The card squares up to the camera and the camera dollies in. */
  dolly: RevealBeat;
  /** A held beat on the card face, then onDone. */
  hold: RevealBeat;
}

const CURTAIN_NORMAL: CurtainBeats = {
  blaze: { at: 0, dur: 0.45 },
  doors: { at: 0.25, dur: 1.3 },
  float: { at: 0.9, dur: 1.9 },
  dolly: { at: 2.8, dur: 1.35 },
  hold: { at: 4.15, dur: 0.25 },
};

const CURTAIN_REDUCED: CurtainBeats = {
  blaze: { at: 0, dur: 0.5 },
  doors: { at: 0.3, dur: 1.5 },
  float: { at: 1.1, dur: 1.8 },
  dolly: { at: 2.9, dur: 1.6 },
  hold: { at: 4.5, dur: 0.25 },
};

export function curtainBeats(reducedMotion: boolean): CurtainBeats {
  return reducedMotion ? CURTAIN_REDUCED : CURTAIN_NORMAL;
}

// ── Hand-off rectangle ────────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where the template's cover sits once CardExperience mounts it, measured on
 * the storybook cover: 16px gutters, at most 448px wide, 32px from the top,
 * 108px of chrome below (pager + replay). A reveal that ends on this rect
 * cross-fades into the cover instead of jumping to it. Never smaller than a
 * sane minimum, so a tiny embed still gets a card, not a sliver.
 */
export function handoffCardRect(vw: number, vh: number): Rect {
  const w = Math.max(200, Math.min(vw - 32, 448));
  const h = Math.max(280, vh - 108);
  return { x: (vw - w) / 2, y: 32, w, h };
}

// ── Seal burst ────────────────────────────────────────────────────────────

export interface Mote {
  /** Travel from the seal's centre, px. */
  dx: number;
  dy: number;
  /** Diameter, px. */
  size: number;
  /** Stagger, s. */
  delay: number;
}

/** mulberry32 — a tiny seeded PRNG, so the burst is the same on every replay. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `n` light motes fanned evenly round the seal (with a little jitter so the
 * ring doesn't read as a clock face), travelling `reach` px at most.
 */
export function burstMotes(n: number, reach: number, seed = 7): Mote[] {
  const count = Math.max(0, Math.floor(n));
  const r = rng(seed);
  const out: Mote[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / Math.max(1, count)) * Math.PI * 2 + (r() - 0.5) * 0.5;
    const dist = reach * (0.45 + r() * 0.55);
    out.push({
      dx: Math.cos(angle) * dist,
      // A little lift: light rises.
      dy: Math.sin(angle) * dist - reach * 0.12,
      size: 3 + r() * 5,
      delay: r() * 0.08,
    });
  }
  return out;
}

// ── Colour ────────────────────────────────────────────────────────────────

const HEX6 = /^#[0-9a-f]{6}$/i;

/**
 * Mix two #rrggbb colours; t=0 → a, t=1 → b. Anything that isn't a 6-digit
 * hex falls back to the other side (a palette from a theme snapshot is
 * validated upstream, but a reveal must never throw over a colour).
 */
export function mixHex(a: string, b: string, t: number): string {
  const okA = HEX6.test(a);
  const okB = HEX6.test(b);
  if (!okA && !okB) return '#000000';
  if (!okA) return b.toLowerCase();
  if (!okB) return a.toLowerCase();
  const k = Math.min(1, Math.max(0, t));
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => {
    const ca = (pa >> shift) & 255;
    const cb = (pb >> shift) & 255;
    return Math.round(ca + (cb - ca) * k);
  };
  const v = (ch(16) << 16) | (ch(8) << 8) | ch(0);
  return `#${v.toString(16).padStart(6, '0')}`;
}

// ── 3D card face: photo collage ───────────────────────────────────────────

/**
 * Rectangles for up to four photos inside a `w`×`h` area with `gap` between
 * them. 0 → none, 1 → the whole area, 2 → side by side, 3 → one tall on the
 * left and two stacked on the right, 4 → a 2×2 grid. Extra photos are ignored.
 */
export function collageRects(n: number, w: number, h: number, gap: number): Rect[] {
  const count = Math.min(4, Math.max(0, Math.floor(n)));
  if (count === 0) return [];
  if (count === 1) return [{ x: 0, y: 0, w, h }];
  const halfW = (w - gap) / 2;
  const halfH = (h - gap) / 2;
  if (count === 2) {
    return [
      { x: 0, y: 0, w: halfW, h },
      { x: halfW + gap, y: 0, w: halfW, h },
    ];
  }
  if (count === 3) {
    return [
      { x: 0, y: 0, w: halfW, h },
      { x: halfW + gap, y: 0, w: halfW, h: halfH },
      { x: halfW + gap, y: halfH + gap, w: halfW, h: halfH },
    ];
  }
  return [
    { x: 0, y: 0, w: halfW, h: halfH },
    { x: halfW + gap, y: 0, w: halfW, h: halfH },
    { x: 0, y: halfH + gap, w: halfW, h: halfH },
    { x: halfW + gap, y: halfH + gap, w: halfW, h: halfH },
  ];
}

/**
 * The source crop that makes an `iw`×`ih` image COVER a `tw`×`th` box
 * (centred), for drawImage(img, sx, sy, sw, sh, …). Degenerate sizes return
 * the whole image rather than NaN.
 */
export function coverCrop(iw: number, ih: number, tw: number, th: number): Rect {
  if (!(iw > 0 && ih > 0 && tw > 0 && th > 0)) return { x: 0, y: 0, w: Math.max(0, iw), h: Math.max(0, ih) };
  const s = Math.max(tw / iw, th / ih);
  const sw = tw / s;
  const sh = th / s;
  return { x: (iw - sw) / 2, y: (ih - sh) / 2, w: sw, h: sh };
}

// ── Drag to tilt ──────────────────────────────────────────────────────────

/**
 * A pointer drag (px since the press) → a tilt of the floating card (radians),
 * clamped so the face never turns more than `max` away. `pxPerRad` sets how
 * far a finger travels for one radian.
 */
export function dragTilt(
  dx: number,
  dy: number,
  max = 0.6,
  pxPerRad = 260,
): { yaw: number; pitch: number } {
  const clamp = (v: number) => Math.max(-max, Math.min(max, v));
  const safe = (v: number) => (Number.isFinite(v) ? v : 0);
  return {
    yaw: clamp(safe(dx) / pxPerRad),
    pitch: clamp(safe(dy) / pxPerRad),
  };
}
