/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cardTemplates — the CLOSED SET of greeting-card templates, plus the pure
 * placement maths the Polaroid template renders from.
 *
 * Why a separate module from lib/cards.ts: cards.ts imports the Supabase
 * client, so nothing under vitest's node env may reach it. Everything here is
 * DOM-free and side-effect free, which keeps the template registry and the
 * scatter maths unit-testable (the templates themselves are .tsx and therefore
 * outside the test glob by policy).
 *
 * DETERMINISM: no Math.random anywhere. A polaroid's tilt/offset is a pure
 * function of the CONTRIBUTION ID, so the same print lands at the same angle
 * across re-renders, StrictMode double-invokes, reorders of the list and a
 * future frame-by-frame render. (lib/beamGeometry.ts:62 `polaroidTilt` solves
 * the neighbouring problem for the landing showcase, but keys on the list
 * INDEX — that is reorder-unstable, so cards key on the id instead. Its 2dp
 * rounding idiom, which keeps CSS values jitter-free, is kept.)
 */

/* ------------------------------------------------------------------ */
/* The closed set                                                      */
/* ------------------------------------------------------------------ */

export type CardTemplateId = 'storybook' | 'filmstrip' | 'polaroid';

/** Every shipped template id, in the order hosts should see them. */
export const CARD_TEMPLATE_IDS = ['storybook', 'filmstrip', 'polaroid'] as const;

/** What a card falls back to: an unknown id must still render something. */
export const DEFAULT_CARD_TEMPLATE: CardTemplateId = 'storybook';

export interface CardTemplateOption {
  id: CardTemplateId;
  /** Host-facing name (the <option> label). */
  label: string;
  /** One line telling a host what they are choosing. */
  description: string;
}

export const CARD_TEMPLATE_OPTIONS: readonly CardTemplateOption[] = [
  {
    id: 'storybook',
    label: 'Storybook',
    description: 'A page-turning book — one message per page, read start to finish.',
  },
  {
    id: 'filmstrip',
    label: 'Film strip',
    description: 'One long scrolling reel — every message is a frame on the strip.',
  },
  {
    id: 'polaroid',
    label: 'Polaroid',
    description: 'Scattered instant prints — handwritten captions on tilted photos.',
  },
];

export function isCardTemplateId(raw: unknown): raw is CardTemplateId {
  return typeof raw === 'string' && (CARD_TEMPLATE_IDS as readonly string[]).includes(raw);
}

/** Any stored/typed value → a template this build can actually render. */
export function normalizeCardTemplate(raw: string | null | undefined): CardTemplateId {
  return isCardTemplateId(raw) ? raw : DEFAULT_CARD_TEMPLATE;
}

/* ------------------------------------------------------------------ */
/* Polaroid scatter — seeded from the contribution id                  */
/* ------------------------------------------------------------------ */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Largest tilt a single print may take, degrees (± this). */
export const POLAROID_MAX_TILT_DEG = 3.2;
/** Largest horizontal nudge a single print may take, % of its own width. */
export const POLAROID_MAX_SHIFT_X_PCT = 2.4;
/** Largest vertical nudge a single print may take, % of its own height. */
export const POLAROID_MAX_SHIFT_Y_PCT = 1.6;
/** Angle between neighbouring prints in the cover fan, degrees. */
export const POLAROID_FAN_STEP_DEG = 9;
/** Horizontal step between neighbouring prints in the cover fan, % of a print's
 *  own width. MEASURED at 390x844: below ~50% the outer prints hide behind the
 *  centre one and the stack reads as a single print with white edges. */
export const POLAROID_FAN_STEP_X_PCT = 62;
/** How far the outer prints of the fan sit below the centre one, %. */
export const POLAROID_FAN_LIFT_PCT = 7;

/**
 * FNV-1a (32-bit) over the id, salted so one id yields several independent
 * streams. Returns an unsigned 32-bit integer.
 */
export function polaroidSeed(id: string, salt = 0): number {
  let h = FNV_OFFSET_BASIS ^ (salt >>> 0);
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i) & 0xff;
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/** Seed → [0, 1). Uses the top 24 bits: FNV's low byte is its weakest. */
function unit(id: string, salt: number): number {
  return (polaroidSeed(id, salt) >>> 8) / 0x1000000;
}

/** Seed → [-1, 1). */
function signedUnit(id: string, salt: number): number {
  return unit(id, salt) * 2 - 1;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Where one instant print sits relative to its slot. */
export interface PolaroidPlacement {
  /** Rotation in degrees, within ±POLAROID_MAX_TILT_DEG. */
  rotationDeg: number;
  /** Horizontal nudge in % of the print's width. */
  offsetXPct: number;
  /** Vertical nudge in % of the print's height. */
  offsetYPct: number;
}

/**
 * THE SEEDING RULE: rotation, x-nudge and y-nudge are three salts (0/1/2) of
 * FNV-1a over the contribution id, each mapped to [-1, 1) and scaled by its
 * own bound, then rounded to 2dp.
 */
export function polaroidPlacement(id: string): PolaroidPlacement {
  return {
    rotationDeg: round2(signedUnit(id, 0) * POLAROID_MAX_TILT_DEG),
    offsetXPct: round2(signedUnit(id, 1) * POLAROID_MAX_SHIFT_X_PCT),
    offsetYPct: round2(signedUnit(id, 2) * POLAROID_MAX_SHIFT_Y_PCT),
  };
}

/** Fraction of a page over which a print settles under a driven render. */
export const POLAROID_ENTRANCE_SPAN = 0.28;

export interface PolaroidEntrance {
  opacity: number;
  /** Vertical offset in px, settling to 0. */
  y: number;
  scale: number;
}

/**
 * The entrance a print is showing at `frameProgress` within its page — the
 * deterministic counterpart to the interactive spring, so a frame renderer
 * driving `frameProgress` gets the same picture every time it asks for the
 * same frame. Out-of-range and non-finite input settles (never NaN in a
 * transform).
 */
export function polaroidEntrance(progress: number): PolaroidEntrance {
  const raw = Number.isFinite(progress) ? progress : 1;
  const p = Math.max(0, Math.min(1, raw / POLAROID_ENTRANCE_SPAN));
  const eased = 1 - (1 - p) ** 3; // cubic ease-out
  return {
    opacity: round2(eased),
    y: round2((1 - eased) * 26),
    scale: round2(0.96 + eased * 0.04),
  };
}

/**
 * The cover's fanned stack: an even spread about the centre (so the fan is
 * symmetric however many prints there are) plus HALF of each print's own
 * seeded jitter, so no two covers fan identically.
 */
export function polaroidFan(ids: readonly string[]): PolaroidPlacement[] {
  const n = ids.length;
  return ids.map((id, i) => {
    const spread = i - (n - 1) / 2; // …-1, 0, +1…
    const jitter = polaroidPlacement(id);
    return {
      rotationDeg: round2(spread * POLAROID_FAN_STEP_DEG + jitter.rotationDeg / 2),
      offsetXPct: round2(spread * POLAROID_FAN_STEP_X_PCT + jitter.offsetXPct / 2),
      offsetYPct: round2(Math.abs(spread) * POLAROID_FAN_LIFT_PCT + jitter.offsetYPct / 2),
    };
  });
}
