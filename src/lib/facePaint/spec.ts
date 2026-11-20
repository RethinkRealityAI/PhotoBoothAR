/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The persisted shape of a Face Paint look — what rides `config.layers[i].facePaint`
 * (jsonb) and `Object3D.facePaint` (studio draft).
 *
 * SHAPE-ONLY ON PURPOSE. This module is imported by the ONE layer↔piece mapper
 * (lib/studio/draftMapping), which every booth bundle carries — including the
 * frozen legacy builds. So it validates structure (a short design id, ≤3 hex
 * colours, an https logo) and knows nothing about which designs exist: the
 * registry and the painter live in designs.ts/painter.ts, reached only through
 * the lazily-loaded FacePaintLayer and the studio builder. An unknown design id
 * survives here and simply paints nothing there — the same "degrade, never
 * throw" rule the template/customization validators follow.
 */

export const FACE_PAINT_PLACEMENTS = ['leftCheek', 'rightCheek', 'bothCheeks', 'forehead'] as const;
export type FacePaintPlacement = (typeof FACE_PAINT_PLACEMENTS)[number];

/** Logo / image stamp — the sponsor hook. `size` multiplies the placement's natural size. */
export interface FacePaintLogo {
  /** https url of the uploaded image (event assets bucket). */
  url: string;
  placement: FacePaintPlacement;
  size: number;
}

export interface FacePaintSpec {
  /** designs.ts FacePaintDesignId, or 'none' for a logo-only look. */
  design: string;
  /** Up to three `#rrggbb` colours, in the design's slot order. */
  colors: string[];
  /** Overall pigment strength, FACE_PAINT_OPACITY.min..max. */
  opacity: number;
  logo?: FacePaintLogo;
}

export const MAX_FACE_PAINT_COLORS = 3;
export const FACE_PAINT_OPACITY = { min: 0.4, max: 1, default: 0.88 } as const;
export const FACE_PAINT_LOGO_SIZE = { min: 0.5, max: 1.6, default: 1 } as const;
/** Procedural id the paint layer rides as (a headpiece no HEAD_PIECES entry claims). */
export const FACE_PAINT_PROCEDURAL_ID = 'face-paint';

const HEX = /^#[0-9a-f]{6}$/;
const DESIGN_ID = /^[a-z0-9-]{1,40}$/;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** A colour string → normalized lowercase `#rrggbb`, or null. */
export function normalizeHex(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const v = input.trim().toLowerCase();
  if (HEX.test(v)) return v;
  // #rgb shorthand is accepted from hand-written configs and expanded.
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return null;
}

/**
 * Only an https url may reach an <img crossOrigin> in the booth. data:/blob:
 * urls are refused (a data url would bloat every config row; a blob url dies
 * with the tab that made it), and so is anything that is not a URL at all.
 */
export function isSafeLogoUrl(input: unknown): input is string {
  if (typeof input !== 'string' || input.length > 2048) return false;
  try {
    return new URL(input).protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeLogo(raw: unknown): FacePaintLogo | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (!isSafeLogoUrl(r.url)) return undefined;
  const placement = (FACE_PAINT_PLACEMENTS as readonly unknown[]).includes(r.placement)
    ? (r.placement as FacePaintPlacement)
    : 'leftCheek';
  const size = typeof r.size === 'number' && Number.isFinite(r.size)
    ? clamp(r.size, FACE_PAINT_LOGO_SIZE.min, FACE_PAINT_LOGO_SIZE.max)
    : FACE_PAINT_LOGO_SIZE.default;
  return { url: r.url, placement, size };
}

/**
 * Untrusted jsonb → a FacePaintSpec, or null when there is nothing paintable
 * (no design AND no logo). Total: never throws.
 */
export function normalizeFacePaint(raw: unknown): FacePaintSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const design = typeof r.design === 'string' && DESIGN_ID.test(r.design) ? r.design : 'none';
  const colors = Array.isArray(r.colors)
    ? r.colors.map(normalizeHex).filter((c): c is string => c !== null).slice(0, MAX_FACE_PAINT_COLORS)
    : [];
  const opacity = typeof r.opacity === 'number' && Number.isFinite(r.opacity)
    ? clamp(r.opacity, FACE_PAINT_OPACITY.min, FACE_PAINT_OPACITY.max)
    : FACE_PAINT_OPACITY.default;
  const logo = normalizeLogo(r.logo);
  if (design === 'none' && !logo) return null;
  return logo ? { design, colors, opacity, logo } : { design, colors, opacity };
}

/** Stable key for "did the look change" (texture repaint, memo deps). */
export function facePaintKey(spec: FacePaintSpec | null | undefined): string {
  if (!spec) return '';
  const l = spec.logo;
  return `${spec.design}|${spec.colors.join(',')}|${spec.opacity}|${l ? `${l.url}|${l.placement}|${l.size}` : ''}`;
}
