/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The persisted shape of a Coloured Contacts look — what rides
 * `config.layers[i].facePaint.eyes` (jsonb) and `Object3D.facePaint.eyes`.
 *
 * SHAPE-ONLY ON PURPOSE, exactly like facePaint/spec.ts (which imports this and
 * is itself carried by every booth bundle, the frozen legacy builds included):
 * it validates structure (a short style id, ≤2 hex colours, two clamped
 * numbers) and knows nothing about which styles exist. The style registry and
 * the lens painter live in lens.ts, reached only through the lazily-loaded
 * ContactLensLayer and the studio builder. An unknown style id survives here
 * and simply draws nothing there (degrade, never throw).
 */

export interface ContactLensSpec {
  /** lens.ts ContactStyleId. */
  style: string;
  /** Up to two `#rrggbb` colours, in the style's slot order. */
  colors: string[];
  /** Lens strength, CONTACT_OPACITY.min..max. */
  opacity: number;
  /** Lens size as a multiple of the guest's measured iris, CONTACT_SIZE.min..max. */
  size: number;
}

export const MAX_CONTACT_COLORS = 2;
export const CONTACT_OPACITY = { min: 0.35, max: 1, default: 0.85 } as const;
export const CONTACT_SIZE = { min: 0.85, max: 1.25, default: 1 } as const;

const HEX = /^#[0-9a-f]{6}$/;
const STYLE_ID = /^[a-z0-9-]{1,40}$/;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function hex(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const v = input.trim().toLowerCase();
  return HEX.test(v) ? v : null;
}

/** Untrusted jsonb → a ContactLensSpec, or null when there is no usable style. Total: never throws. */
export function normalizeContacts(raw: unknown): ContactLensSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.style !== 'string' || !STYLE_ID.test(r.style)) return null;
  const colors = Array.isArray(r.colors)
    ? r.colors.map(hex).filter((c): c is string => c !== null).slice(0, MAX_CONTACT_COLORS)
    : [];
  const opacity = typeof r.opacity === 'number' && Number.isFinite(r.opacity)
    ? clamp(r.opacity, CONTACT_OPACITY.min, CONTACT_OPACITY.max)
    : CONTACT_OPACITY.default;
  const size = typeof r.size === 'number' && Number.isFinite(r.size)
    ? clamp(r.size, CONTACT_SIZE.min, CONTACT_SIZE.max)
    : CONTACT_SIZE.default;
  return { style: r.style, colors, opacity, size };
}

/** Stable key for "did the lens change" (texture repaint, memo deps). */
export function contactsKey(spec: ContactLensSpec | null | undefined): string {
  if (!spec) return '';
  return `${spec.style}|${spec.colors.join(',')}|${spec.opacity}|${spec.size}`;
}
