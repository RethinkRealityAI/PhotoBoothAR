/**
 * Sky effects, part 1: which ones exist and how the booth reaches them. PURE
 * (no DOM, no WebGL), so it is unit-tested in node. The picture itself is
 * skyShader.ts; the 8th Wall wiring is xr8World.ts.
 *
 * WHAT: 8th Wall's sky layer finds the sky in the back camera's picture, and a
 * sky effect repaints it (a sunset, stars, fireworks, lanterns...) while the
 * rest of the scene is graded to match. They show as AR tiles in the booth's
 * Effects tab.
 *
 * WHERE: the sky layer is part of 8th Wall's world engine, which can never
 * share a page with its face engine (both define window.XR8, see xr8World.ts),
 * and it needs the back camera. So a sky effect runs on the same AR page as
 * the 3D standing Frames: `/e/<slug>/booth?ar=sky&sky=<id>` on its own, or
 * `?ar=<frameId>&sky=<id>` with a Frame standing under it. PLATFORM booths on
 * phones only; legacy events never get the tiles.
 */
import type { Experience } from '../../types';

export const SKY_EFFECT_IDS = ['golden', 'stars', 'aurora', 'fireworks', 'lanterns', 'hearts', 'names', 'petals', 'heartbursts', 'vows'] as const;
export type SkyEffectId = typeof SKY_EFFECT_IDS[number];

export interface SkyEffect {
  id: SkyEffectId;
  name: string;
  /** One line for the guides and the intro card. */
  blurb: string;
  /** Two colours for the tile's thumbnail (top, bottom). */
  swatch: readonly [string, string];
  /** A small mark on the tile. */
  mark: string;
  /** Writes words in the sky: 'name' = the event's name, 'vows' = the name with the hashtag under it. */
  text?: 'name' | 'vows';
  /**
   * Made for one kind of event: the tile shows only in events dressed in one
   * of these theme packs (lib/themePacks). Absent = every platform event.
   */
  packs?: readonly string[];
}

// Names are short on purpose: a tile's label is two lines of about eight
// letters, and the strip drops a first word that neighbours share (the booth
// already has a "Golden Hour" colour effect).
export const SKY_EFFECTS: readonly SkyEffect[] = [
  { id: 'golden', name: 'Sunset Sky', blurb: 'Turns any sky into a warm sunset.', swatch: ['#6b4a9a', '#ffb45c'], mark: '☀' },
  { id: 'stars', name: 'Starry Night', blurb: 'A night full of stars, with a shooting star now and then.', swatch: ['#050a22', '#1d2a66'], mark: '✦' },
  { id: 'aurora', name: 'Northern Lights', blurb: 'Green and violet lights rippling across the sky.', swatch: ['#06142a', '#2bd99a'], mark: '≋' },
  { id: 'fireworks', name: 'Firework Sky', blurb: 'Fireworks bursting overhead in the event colours.', swatch: ['#070b24', '#3a1d5c'], mark: '✺' },
  { id: 'lanterns', name: 'Sky Lanterns', blurb: 'Glowing paper lanterns drifting up at dusk.', swatch: ['#1a1d4d', '#e07a45'], mark: '❍' },
  { id: 'hearts', name: 'Floating Hearts', blurb: 'Hearts floating up through a blushing sky.', swatch: ['#f7a8c4', '#ffd9cf'], mark: '♥' },
  { id: 'names', name: 'Names in Stars', blurb: 'The event name written in starlight.', swatch: ['#050a22', '#27306e'], mark: 'Aa', text: 'name' },
  // The island wedding set (ForeverWeDO, Jamaica): golden hour, hibiscus, gold and teal.
  { id: 'petals', name: 'Hibiscus Rain', blurb: 'Hibiscus and frangipani drifting down through an island sunset.', swatch: ['#2f7f73', '#ffb85c'], mark: '✿', packs: ['island-golden-hour'] },
  { id: 'heartbursts', name: 'Heart Bursts', blurb: 'Fireworks that open into hearts, in the event colours.', swatch: ['#071a2a', '#1f5a5c'], mark: '♡', packs: ['island-golden-hour'] },
  { id: 'vows', name: 'Forever Sky', blurb: 'The couple’s names in gold across an island sunset, with the hashtag beneath.', swatch: ['#c85a5a', '#ffd27a'], mark: '∞', text: 'vows', packs: ['island-golden-hour'] },
];

export function skyEffect(id: string | null | undefined): SkyEffect | null {
  return SKY_EFFECTS.find((e) => e.id === id) ?? null;
}

/* ------------------------------------------------------------------ */
/* The Effects slot                                                     */
/* ------------------------------------------------------------------ */

/** A sky effect sits in the Effects slot as shader id `sky:<id>`. */
export const SKY_SHADER_PREFIX = 'sky:';

export function isSkyShaderId(shaderId: string | null | undefined): boolean {
  return typeof shaderId === 'string' && shaderId.startsWith(SKY_SHADER_PREFIX)
    && skyEffect(shaderId.slice(SKY_SHADER_PREFIX.length)) !== null;
}

export function skyIdOfShader(shaderId: string | null | undefined): SkyEffectId | null {
  return isSkyShaderId(shaderId) ? shaderId!.slice(SKY_SHADER_PREFIX.length) as SkyEffectId : null;
}

/** The regular shader the stage should run: a sky effect is not one of them. */
export function stageShaderId(effectId: string): string {
  return isSkyShaderId(effectId) ? 'none' : effectId;
}

const NOW = '2026-01-01T00:00:00Z';

/**
 * The sky effects as Effects-tab tiles (ids `builtin:shader:sky:<id>`, like
 * every built-in effect). `themePack` is the event's theme pack, if it wears
 * one: effects made for a pack show only there, and lead the row.
 */
export function skyExperiences(hidden: readonly string[] = [], themePack: string | null = null): Experience[] {
  const off = new Set(hidden);
  const shown = SKY_EFFECTS.filter((e) => !e.packs || (themePack !== null && e.packs.includes(themePack)));
  const ordered = [...shown.filter((e) => e.packs), ...shown.filter((e) => !e.packs)];
  return ordered.map((e, i): Experience => ({
    id: `builtin:shader:${SKY_SHADER_PREFIX}${e.id}`,
    name: e.name,
    created_at: NOW,
    updated_at: NOW,
    is_published: true,
    featured: true,
    sort_order: 180 + i,
    thumbnail_url: null,
    kind: 'shader',
    asset_url: null,
    config: { shader: { shaderId: `${SKY_SHADER_PREFIX}${e.id}`, params: {} } },
  })).filter((e) => !off.has(e.id));
}

/* ------------------------------------------------------------------ */
/* The AR page                                                          */
/* ------------------------------------------------------------------ */

/** `?sky=<id>` on the AR page. */
export const SKY_PARAM = 'sky';
/** `?ar=sky`: the AR page with no standing Frame, only the sky. */
export const SKY_ONLY_AR_ID = 'sky';

export function skyIdFrom(search: string): SkyEffectId | null {
  return skyEffect(new URLSearchParams(search).get(SKY_PARAM))?.id ?? null;
}

/**
 * The AR page's query after the sky effect changes. `arId` is what the page
 * stands up now (`sky` or a frame id). Returns null when nothing is left to
 * show there (sky-only page, effect switched off): leave the AR page.
 */
export function skyQuery(search: string, arId: string, skyId: SkyEffectId | null): string | null {
  const p = new URLSearchParams(search);
  if (skyId === null) {
    if (arId === SKY_ONLY_AR_ID) return null;
    p.delete(SKY_PARAM);
  } else {
    p.set(SKY_PARAM, skyId);
  }
  p.set('ar', arId);
  return p.toString();
}

/* ------------------------------------------------------------------ */
/* The dome                                                             */
/* ------------------------------------------------------------------ */

interface Quat { x: number; y: number; z: number; w: number }

/**
 * Which way the camera faces along the ground, as a unit (x, z), for anchoring
 * an effect in front of the guest. Looking straight up or down the forward
 * direction has no ground heading, so the camera's top edge stands in.
 */
export function headingOf(q: Quat): [number, number] {
  // forward = q * (0, 0, -1), up = q * (0, 1, 0)
  const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  let hx = fx, hz = fz;
  if (Math.hypot(hx, hz) < 0.25) {
    const fy = -2 * (q.y * q.z - q.w * q.x);
    const ux = 2 * (q.x * q.y - q.w * q.z), uz = 2 * (q.y * q.z + q.w * q.x);
    // Looking up, the top of the picture points backwards over the head.
    const s = fy > 0 ? -1 : 1;
    hx = s * ux; hz = s * uz;
  }
  const h = Math.hypot(hx, hz);
  return h > 1e-6 ? [hx / h, hz / h] : [0, -1];
}

/**
 * The 3x3 that turns a camera-space ray into a dome ray (column-major, for a
 * mat3 uniform). The dome's forward (-z) is `heading`, y is up.
 */
export function domeRotation(q: Quat, heading: readonly [number, number], out: Float32Array): Float32Array {
  const { x, y, z, w } = q;
  // Camera-to-world rotation R, row by row.
  const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - z * w), r02 = 2 * (x * z + y * w);
  const r10 = 2 * (x * y + z * w), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - x * w);
  const r20 = 2 * (x * z - y * w), r21 = 2 * (y * z + x * w), r22 = 1 - 2 * (x * x + y * y);
  const [fx, fz] = heading;
  // Dome basis rows: right = forward x up = (-fz, 0, fx), up, -forward.
  const m00 = -fz, m02 = fx, m20 = -fx, m22 = -fz;
  out[0] = m00 * r00 + m02 * r20; out[1] = r10; out[2] = m20 * r00 + m22 * r20;
  out[3] = m00 * r01 + m02 * r21; out[4] = r11; out[5] = m20 * r01 + m22 * r21;
  out[6] = m00 * r02 + m02 * r22; out[7] = r12; out[8] = m20 * r02 + m22 * r22;
  return out;
}

/* ------------------------------------------------------------------ */
/* Colours and words                                                    */
/* ------------------------------------------------------------------ */

type Rgb = [number, number, number];

function hexRgb(hex: string | undefined): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Lights in the sky must glow: lift a dark colour until its brightest channel is 0.9. */
function glow(c: Rgb): Rgb {
  const mx = Math.max(c[0], c[1], c[2]);
  if (mx < 0.08) return [0.9, 0.9, 0.9];
  const k = Math.max(1, 0.9 / mx);
  return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
}

/** The two event colours the effects use (fireworks, hearts, the glow on the names). */
export function skyPalette(accentHexes: readonly string[] | undefined): [Rgb, Rgb] {
  const a = hexRgb(accentHexes?.[0]) ?? [0.83, 0.69, 0.22];
  const second = hexRgb(accentHexes?.[1]);
  // No second colour (or the same one twice): its channels turned round.
  const b = second && Math.hypot(second[0] - a[0], second[1] - a[1], second[2] - a[2]) > 0.12 ? second : [a[2], a[0], a[1]] as Rgb;
  return [glow(a), glow(b)];
}

export const SKY_TEXT_MAX = 36;

/**
 * The words for "Names in Stars", tidied, or null when there are none:
 * the event's full name (a wedding's is the couple, "Mariba & Philip") and
 * only without one its short name (often a hashtag).
 */
export function skyText(fullName: string | null | undefined, eventName?: string | null): string | null {
  const tidy = (v: string | null | undefined) => (v ?? '').replace(/\s+/g, ' ').trim();
  const t = tidy(fullName) || tidy(eventName);
  if (t.length === 0) return null;
  return t.length <= SKY_TEXT_MAX ? t : `${t.slice(0, SKY_TEXT_MAX - 1).trimEnd()}…`;
}

/**
 * The words an effect writes, or null: 'name' is skyText(); 'vows' is the
 * full name with the short name (the hashtag) on a second line, when the
 * event has both and they differ.
 */
export function skyWords(id: SkyEffectId, fullName: string | null | undefined, eventName?: string | null): string | null {
  const kind = skyEffect(id)?.text;
  if (!kind) return null;
  const first = skyText(fullName, eventName);
  if (kind === 'name' || first === null) return first;
  const second = skyText(eventName);
  return second !== null && second !== first && skyText(fullName) !== null ? `${first}\n${second}` : first;
}

/* ------------------------------------------------------------------ */
/* "Point at the sky"                                                   */
/* ------------------------------------------------------------------ */

/** Under this share of the picture, there is no sky worth painting. */
export const SKY_MIN_SHARE = 0.04;
/** Wait this long before saying so (the first pictures have no mask yet). */
export const SKY_HINT_AFTER_MS = 2500;

/** Should the booth say "Point your camera at the sky"? `sinceSkyMs` = time since sky was last in view. */
export function wantsSkyHint(sinceSkyMs: number): boolean {
  return sinceSkyMs >= SKY_HINT_AFTER_MS;
}

/* ------------------------------------------------------------------ */
/* The skyline                                                          */
/* ------------------------------------------------------------------ */
// "20 degrees up" means nothing when rooftops or palm trees fill the first 30:
// fireworks would burst behind the hotel. So the effects are laid out above
// the SKYLINE, the lowest sky this camera can see, found from a small copy of
// the mask (skyShader.SkyPass.probe).

export const SKY_PROBE_W = 16;
export const SKY_PROBE_H = 32;

/** Where the camera picture sits in the canvas, and the canvas's projection. */
export interface SkyView {
  vp: { offsetX: number; offsetY: number; width: number; height: number };
  canvasW: number;
  canvasH: number;
  /** Column-major projection matrix. */
  proj: ArrayLike<number>;
  /** domeRotation(). */
  rot: ArrayLike<number>;
}

/** Elevation (radians) of the dome ray through a point of the camera picture (u, v in 0..1, v down). */
export function elevationAt(view: SkyView, u: number, v: number): number {
  const px = view.vp.offsetX + u * view.vp.width, py = view.vp.offsetY + (1 - v) * view.vp.height;
  const nx = px / view.canvasW * 2 - 1, ny = py / view.canvasH * 2 - 1;
  const cx = (nx + view.proj[8]) / view.proj[0], cy = (ny + view.proj[9]) / view.proj[5], cz = -1;
  const r = view.rot;
  const y = r[1] * cx + r[4] * cy + r[7] * cz;
  const x = r[0] * cx + r[3] * cy + r[6] * cz, z = r[2] * cx + r[5] * cy + r[8] * cz;
  return Math.asin(Math.max(-1, Math.min(1, y / Math.hypot(x, y, z))));
}

/**
 * The skyline's elevation from a mask probe (row 0 = top of the picture, over
 * 127 = sky): in each column the lowest sky pixel that has sky right above it,
 * then the median over the columns that see sky. null when under a fifth of
 * the columns do, or when the sky runs off the bottom of the picture (the
 * skyline is out of view, so this picture cannot say where it is).
 */
export function skylineElevation(probe: ArrayLike<number>, view: SkyView): number | null {
  const els: number[] = [];
  let offBottom = 0;
  for (let cx = 0; cx < SKY_PROBE_W; cx++) {
    let row = -1;
    for (let cy = SKY_PROBE_H - 1; cy >= 1; cy--) {
      if (probe[cy * SKY_PROBE_W + cx] > 127 && probe[(cy - 1) * SKY_PROBE_W + cx] > 127) { row = cy; break; }
    }
    if (row < 0) continue;
    if (row === SKY_PROBE_H - 1) { offBottom++; continue; }
    els.push(elevationAt(view, (cx + 0.5) / SKY_PROBE_W, (row + 1) / SKY_PROBE_H));
  }
  if (offBottom > els.length || els.length < SKY_PROBE_W / 5) return null;
  els.sort((a, b) => a - b);
  return els[els.length >> 1];
}

/** Keep the skyline in a sane band, and move towards a new reading gently (no jumps in the sky). */
export function easeSkyline(prev: number | null, reading: number): number {
  const r = Math.max(-0.2, Math.min(0.9, reading));
  return prev === null ? r : prev + (r - prev) * 0.25;
}
