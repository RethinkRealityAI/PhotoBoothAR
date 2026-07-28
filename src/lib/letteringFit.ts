/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Type-fitting for the guest's own name drawn onto the booth frame.
 *
 * The booth composites the SAME scene at two sizes — a 720×1280 live preview
 * and a 1080×1920 capture — so every number here is a FRACTION of the canvas,
 * never a constant: a name that sits in the lower band on screen has to sit in
 * the lower band in the photo the guest keeps.
 *
 * Pure (no canvas, no DOM) so it runs under the vitest node env. Measuring the
 * real glyph advance would need a canvas context, so width is estimated from a
 * per-style average character-width ratio — deliberately generous, because a
 * name that renders slightly small is fine and one that runs off the edge is not.
 */

/** The four looks a host can pick for guest-name lettering. */
export type GuestLetteringStyle = 'script' | 'serif' | 'block' | 'label';

/**
 * Average glyph advance as a fraction of font size, per style. Script faces are
 * narrow and connected; block capitals are wide; `label` is tracked-out
 * uppercase, so its ratio carries the extra letter-spacing.
 */
export const CHAR_WIDTH_RATIO: Record<GuestLetteringStyle, number> = {
  script: 0.42,
  serif: 0.48,
  block: 0.62,
  label: 0.55,
};

/** Fraction of the band's height a cap-height line may occupy. */
const HEIGHT_FILL = 0.72;

/**
 * Smallest legible size, in CAPTURE pixels (the 1080-wide base). Callers
 * rendering at another width scale it (`30 * w / 1080`) so the fitted result is
 * identical in the preview and the photo.
 */
export const MIN_FONT_PX = 30;

const STYLES: ReadonlySet<string> = new Set<GuestLetteringStyle>(['script', 'serif', 'block', 'label']);
const PLACEMENTS: ReadonlySet<string> = new Set(['top', 'bottom']);

/** Default colour when a stored config omits one. */
export const DEFAULT_LETTERING_COLOR = '#FFFFFF';

/**
 * Validate an `experiences.config.lettering` value (untrusted jsonb) into a
 * usable config, or null. Null means "draw nothing", which is what every event
 * that predates this feature — including the frozen legacy ones — resolves to.
 *
 * Shaped like the booth's other config readers: unknown ids are rejected
 * outright rather than coerced, but a missing colour falls back rather than
 * failing the whole config (a white name is always readable over a frame).
 */
export function normalizeGuestLettering(v: unknown): {
  token: 'guestName' | 'fixed';
  text: string;
  style: GuestLetteringStyle;
  color: string;
  placement: 'top' | 'bottom';
} | null {
  if (v === null || v === undefined || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const token = o.token === 'fixed' ? 'fixed' : o.token === 'guestName' ? 'guestName' : null;
  if (!token) return null;
  const style = typeof o.style === 'string' && STYLES.has(o.style) ? (o.style as GuestLetteringStyle) : null;
  if (!style) return null;
  const placement = typeof o.placement === 'string' && PLACEMENTS.has(o.placement)
    ? (o.placement as 'top' | 'bottom')
    : null;
  if (!placement) return null;
  const text = typeof o.text === 'string' ? o.text.trim().slice(0, 60) : '';
  // A 'fixed' line with nothing to say is the same as no lettering at all.
  if (token === 'fixed' && !text) return null;
  const color = typeof o.color === 'string' && o.color.trim() ? o.color.trim() : DEFAULT_LETTERING_COLOR;
  return { token, text, style, color, placement };
}

export interface LetteringFit {
  /** Font size in px for this region. 0 means "draw nothing". */
  fontPx: number;
  /** The string to draw — the name, or an ellipsised prefix of it. */
  text: string;
}

/**
 * Fit `name` into a region: as large as the band allows, shrinking with length,
 * and never below MIN_FONT_PX — past that the name is truncated with an
 * ellipsis instead, because a 12px name in a photo is just noise.
 */
export function fitLettering(
  name: string,
  regionW: number,
  regionH: number,
  style: GuestLetteringStyle,
  /** Legibility floor, scaled by the caller for non-1080 canvases. */
  minFontPx: number = MIN_FONT_PX,
): LetteringFit {
  const text = name.trim();
  // No name is a legitimate state (the guest skipped the prompt), not an error.
  if (!text) return { fontPx: 0, text: '' };
  if (!(regionW > 0) || !(regionH > 0)) return { fontPx: 0, text: '' };

  const ratio = CHAR_WIDTH_RATIO[style];
  const ideal = Math.min(regionH * HEIGHT_FILL, regionW / (text.length * ratio));
  if (ideal >= minFontPx) return { fontPx: ideal, text };

  // Too long to be legible at full length — keep the floor size and cut the
  // name to what actually fits, ellipsis included in the count.
  const maxChars = Math.floor(regionW / (minFontPx * ratio));
  if (maxChars <= 1) return { fontPx: minFontPx, text: '…' };
  return { fontPx: minFontPx, text: `${text.slice(0, maxChars - 1)}…` };
}

export interface LetteringRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The band the lettering lives in, as absolute px for a w×h canvas. Both bands
 * are inset 10% either side; the bottom one sits above the signature watermark
 * (which is drawn at h−58 of the capture) rather than on top of it.
 */
export function regionForPlacement(placement: 'top' | 'bottom', w: number, h: number): LetteringRegion {
  return {
    x: 0.10 * w,
    y: (placement === 'top' ? 0.045 : 0.875) * h,
    w: 0.80 * w,
    h: 0.075 * h,
  };
}
