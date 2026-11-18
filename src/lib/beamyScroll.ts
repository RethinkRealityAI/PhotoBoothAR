/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * beamyScroll — the scroll director for /beamy. Pure, DOM-free, tested in node.
 *
 * /beamy is a normal, natively scrolling page. Beamy lives on one fixed
 * full-viewport canvas and travels with the page: every section ("stop")
 * declares where he stands (an empty anchor element the page measures once
 * per layout change, in DOCUMENT coordinates), and this module turns the
 * cached anchors plus the current scroll position into his target for this
 * frame. No DOM reads happen per frame; the stage then lerps toward the target
 * with a clamped velocity, so fast scrolls never make him jitter or teleport.
 *
 *   • Settled on a stop he rides WITH his anchor (it is part of the page),
 *     held inside a vertical band so he never leaves the viewport.
 *   • Around each section boundary (a fixed window of the viewport height) he
 *     glides from one anchor to the next THROUGH THE GUTTER between the two
 *     sections: he steps into the gap (shrinking a little, as if further
 *     away), crosses the page there, and steps up onto the next anchor. The
 *     gap is the one place a body can cross the page without passing over
 *     copy; the stage adds the waddle and hop on top.
 *   • Phones stand him in a viewport-fixed dock under the content. The hero
 *     keeps its in-flow anchor; going between the two he dissolves at the
 *     start of the glide and re-forms at the end (presence → 0 mid-way), so he
 *     never sweeps across the copy in between.
 */

export interface Pt { x: number; y: number; }

export type Side = 'left' | 'right' | 'centre';

export type StopId =
  | 'hero' | 'explain' | 'film-booth' | 'film-wall' | 'film-challenges' | 'film-cards'
  | 'pick' | 'try' | 'magic' | 'how' | 'pricing' | 'start';

/** What Beamy does the first time a stop becomes active (once per page view). */
export type Presenting =
  | 'intro'        // the hero's beam drop + selfie
  | 'handZap'      // hand raised: one short beam per card, staggered
  | 'mouthCone'    // Beamy blast that settles into a projector cone onto a film
  | 'handCone'     // the same cone from the raised hand
  | 'drift'        // hand raised, light motes drift onto the cards
  | 'blast'        // the signature mouth beam onto the booth
  | 'sparks'       // the 3D prop condenses out of sparks
  | 'hop';         // a hop and a light burst

export interface StopDef {
  id: StopId;
  /** Short name for the header progress and logs. */
  label: string;
  /** Which side Beamy stands on at desktop widths (the content takes the other side). */
  side: Side;
  presenting: Presenting;
}

/**
 * Top to bottom. Sides alternate (hero centre → right → left …) and no two
 * neighbouring stops share a presenting action.
 */
export const STOPS: StopDef[] = [
  { id: 'hero', label: 'Hello', side: 'centre', presenting: 'intro' },
  { id: 'explain', label: 'The idea', side: 'right', presenting: 'handZap' },
  { id: 'film-booth', label: 'Photo booth', side: 'left', presenting: 'mouthCone' },
  { id: 'film-wall', label: 'Live wall', side: 'right', presenting: 'handCone' },
  { id: 'film-challenges', label: 'Challenges', side: 'left', presenting: 'mouthCone' },
  { id: 'film-cards', label: 'Keepsakes', side: 'right', presenting: 'handCone' },
  { id: 'pick', label: 'For you', side: 'left', presenting: 'drift' },
  { id: 'try', label: 'Try it', side: 'centre', presenting: 'blast' },
  { id: 'magic', label: '3D magic', side: 'left', presenting: 'sparks' },
  { id: 'how', label: 'How it works', side: 'right', presenting: 'handZap' },
  { id: 'pricing', label: 'Pricing', side: 'left', presenting: 'drift' },
  { id: 'start', label: 'Start', side: 'centre', presenting: 'hop' },
];

export function stopIndex(id: StopId): number {
  return STOPS.findIndex((s) => s.id === id);
}

/** A stop as measured on the page (document px; x is viewport px — the page never scrolls sideways). */
export interface StopAnchor {
  /** Section box, document px. */
  top: number;
  bottom: number;
  /** Where his feet stand when he presents this stop, document px. */
  feet: Pt;
  /** His height there, px. */
  heightPx: number;
  side: Side;
  /** Phones: he stands in the viewport-fixed dock (feet.y is ignored). */
  docked: boolean;
}

export interface DirectorInput {
  stops: StopAnchor[];
  scrollY: number;
  vpH: number;
  /** Where a docked stop's feet are, viewport px y (x comes from the stop). */
  dockY: number;
  /** The vertical band his whole body must stay inside, viewport px. */
  band: { top: number; bottom: number };
}

export interface BeamyTarget {
  /** Feet point, viewport px. */
  x: number;
  y: number;
  heightPx: number;
  /** Body turn, radians (+ = toward the viewer's right). */
  yaw: number;
  /** 0 = dissolved (mid-way between the hero and the dock), 1 = all there. */
  presence: number;
  /** The stop he is presenting (or about to). */
  active: number;
  /** Progress through the active stop's section, 0..1. */
  progress: number;
  /** Between two stops right now (eased 0.02..0.98 of a glide). */
  travelling: boolean;
  /** −1 left, 0 still, 1 right: the way he is heading. */
  heading: number;
}

/** The focus line, as a fraction of the viewport height from its top. */
export const FOCUS = 0.55;
/** A glide happens while the focus line is within this window around the next section's top (× vpH). */
export const GLIDE_BEFORE = 0.35;
export const GLIDE_AFTER = 0.15;
/** His size while crossing in the gutter, × his height (the gap is ~2 × section padding). */
export const GUTTER_SCALE = 0.62;
/** Settled body turn toward the content. */
export const FACE_YAW = 0.32;
/** Body turn while gliding (toward where he is going). */
export const TRAVEL_YAW = 0.7;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a || 1), 0, 1);
  return t * t * (3 - 2 * t);
};

export function facingYaw(side: Side): number {
  return side === 'left' ? FACE_YAW : side === 'right' ? -FACE_YAW : 0;
}

/** One stop's settled feet point in the viewport for this scroll position. */
export function settledAt(s: StopAnchor, inp: Pick<DirectorInput, 'scrollY' | 'dockY' | 'band'>): Pt {
  if (s.docked) return { x: s.feet.x, y: inp.dockY };
  const y = s.feet.y - inp.scrollY;
  // Ride with the anchor, but never let any of him leave the band.
  const lo = inp.band.top + s.heightPx;
  const hi = Math.max(lo, inp.band.bottom);
  return { x: s.feet.x, y: clamp(y, lo, hi) };
}

/** Beamy's target for this frame. With no stops he waits mid-screen. */
export function directBeamy(inp: DirectorInput): BeamyTarget {
  const { stops, scrollY, vpH } = inp;
  if (stops.length === 0) {
    return { x: 0, y: vpH * 0.6, heightPx: 160, yaw: 0, presence: 1, active: 0, progress: 0, travelling: false, heading: 0 };
  }
  const f = scrollY + vpH * FOCUS;
  // The glide that the focus line is in (or past): stop i → i+1 runs while
  // f ∈ [top(i+1) − before, top(i+1) + after].
  let from = 0;
  let e = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    const edge = stops[i + 1].top;
    const a = edge - vpH * GLIDE_BEFORE;
    const b = edge + vpH * GLIDE_AFTER;
    if (f < a) break;
    from = i;
    e = smoothstep(a, b, f);
    if (f <= b) break;
    // Fully past this boundary: settled on i+1 unless a later window applies.
    from = i + 1;
    e = 0;
  }
  const to = Math.min(stops.length - 1, from + 1);
  const A = stops[from];
  const B = stops[to];
  const pa = settledAt(A, inp);
  const pb = settledAt(B, inp);
  const k = from === to ? 0 : e;
  // Dock ↔ in-flow: dissolve out, travel unseen, re-form (never sweep over copy).
  const swap = A.docked !== B.docked && from !== to;
  const presence = swap ? clamp(Math.abs(2 * k - 1) * 1.25 - 0.25, 0, 1) : 1;
  // In-flow → in-flow: down into the gutter, across, up onto the next anchor.
  const gutter = from !== to && !swap && !A.docked && !B.docked;
  const into = smoothstep(0, 0.35, k);
  const out = smoothstep(0.65, 1, k);
  const across = gutter ? smoothstep(0.2, 0.8, k) : k;
  const dip = gutter ? into * (1 - out) : 0;
  const heightPx = (A.heightPx + (B.heightPx - A.heightPx) * k) * (1 - (1 - GUTTER_SCALE) * dip);
  const x = pa.x + (pb.x - pa.x) * across;
  let y: number;
  if (gutter) {
    // Feet half a body under the boundary, so his middle sits in the gap.
    const gy = B.top - scrollY + heightPx / 2;
    y = pa.y + (gy - pa.y) * into;
    y += (pb.y - y) * out;
  } else {
    y = pa.y + (pb.y - pa.y) * k;
  }
  y = clamp(y, inp.band.top + heightPx, Math.max(inp.band.top + heightPx, inp.band.bottom));
  const travelling = from !== to && k > 0.02 && k < 0.98;
  const heading = travelling ? Math.sign(pb.x - pa.x) : 0;
  const active = k < 0.5 ? from : to;
  const S = stops[active];
  const progress = clamp((f - S.top) / Math.max(1, S.bottom - S.top), 0, 1);
  const yaw = travelling && heading !== 0 ? heading * TRAVEL_YAW : facingYaw(S.side);
  return { x, y, heightPx, yaw, presence, active, progress, travelling, heading };
}

/**
 * Smooth-follow step for the stage: exponential approach with a velocity cap,
 * so a fast fling of the page becomes a quick glide instead of a jump.
 */
export function followStep(pos: Pt, target: Pt, dt: number, maxSpeed: number, rate = 7): Pt {
  const k = 1 - Math.exp(-rate * Math.max(0, dt));
  let dx = (target.x - pos.x) * k;
  let dy = (target.y - pos.y) * k;
  const step = Math.hypot(dx, dy);
  const cap = maxSpeed * Math.max(0, dt);
  if (step > cap && step > 0) { dx *= cap / step; dy *= cap / step; }
  return { x: pos.x + dx, y: pos.y + dy };
}

/** Header progress: how far down the page, 0..1. */
export function pageProgress(scrollY: number, docH: number, vpH: number): number {
  return clamp(scrollY / Math.max(1, docH - vpH), 0, 1);
}

/**
 * A section's reveal must never strand content: it reveals when Beamy's action
 * lands, and at the latest when the visitor has scrolled on (left the stop or
 * read most of it) or the fallback timer runs out.
 */
export function mustRevealNow(opts: { active: boolean; progress: number; sinceEnterMs: number; modelReady: boolean }): boolean {
  if (!opts.modelReady) return true;
  if (!opts.active) return true;
  return opts.progress > 0.7 || opts.sinceEnterMs > REVEAL_FALLBACK_MS;
}
export const REVEAL_FALLBACK_MS = 2600;
