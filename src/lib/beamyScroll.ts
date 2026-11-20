/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * beamyScroll — the slot/pose glide for /beamy. Pure, DOM-free, tested in node.
 *
 * /beamy is a normal, natively scrolling page with ONE fixed full-screen
 * canvas behind it. Beamy is not placed by code: every 3D section holds an
 * empty `[data-slot]` box that CSS alone places and sizes per breakpoint
 * (left, right or centre, alternating with the content; on phones above or
 * below the copy). Every frame the page reads each slot's viewport rect and
 * this module turns them into ONE target pose:
 *
 *   • each slot is weighted by how close its centre is to the viewport's
 *     centre, w = exp(−(d / 0.42)²) with d in viewport heights;
 *   • the target is the weighted average of every slot's pose (feet point,
 *     height, body turn — angles averaged through sin/cos so they never spin
 *     the long way round — and the 0..1 weights of the 3D effects drawn
 *     beside him);
 *   • the stage follows it with glideStep: the target's own frame-to-frame
 *     move is fed straight through (no lag while scrolling), and only the
 *     remainder is eased, 1 − exp(−k·dt).
 *
 * No scroll library, no keyframes: he flows between sections at any scroll
 * speed, passing BEHIND the page (the canvas is under the content). On
 * phones a split weight dissolves him (presence), so he never shows through
 * copy; he re-forms in the next slot.
 *
 * The pinned story: a section n×85vh + 100vh tall (75vh a step on phones)
 * holding a sticky 100vh panel; step = floor(progress × n).
 */

export interface Pt { x: number; y: number; }
export interface Box { left: number; top: number; width: number; height: number; }

export type Side = 'left' | 'right' | 'centre';

export type StopId = 'hero' | 'story' | 'pick' | 'try' | 'pricing' | 'start';

export interface StopDef {
  id: StopId;
  /** Short name for logs and the style guide's progress specimen. */
  label: string;
  /** Where Beamy's slot sits at desktop widths (the content takes the other side). */
  side: Side;
  /** How far the section's field has sunk into the midnight atmosphere (0 bright … 1 midnight). */
  night: number;
}

/** Top to bottom. Beamy's slot alternates sides with the content. */
export const STOPS: StopDef[] = [
  { id: 'hero', label: 'Hello', side: 'centre', night: 0.15 },
  // He stands centred in the pinned story; its six scenes stand round him.
  { id: 'story', label: 'How it works', side: 'centre', night: 0.85 },
  { id: 'pick', label: 'For you', side: 'left', night: 1 },
  { id: 'try', label: 'Try it', side: 'centre', night: 0.9 },
  { id: 'pricing', label: 'Pricing', side: 'right', night: 0.6 },
  { id: 'start', label: 'Start', side: 'left', night: 0.35 },
];

export function stopIndex(id: StopId): number {
  return STOPS.findIndex((s) => s.id === id);
}

/** Gaussian width of a slot's pull, in viewport heights. */
export const SIGMA = 0.42;
/** The longest frame step any easing takes: a hiccup slows motion, never skips it. */
export const DT_MAX = 0.034;
/** Damping rates (per second): position/size, then everything else. */
export const K_POS = 12.6;
export const K_SOFT = 5.4;

/** How Beamy looks in one slot. */
export interface Pose {
  /** Fraction of the slot's height he stands (1 = head at the slot's top). */
  fit: number;
  /** His width-to-height when fitting a narrow slot (he is ~0.85× as wide as tall, arms in). */
  fitW?: number;
  /** Feet x inside the slot, 0 left … 1 right (default centre). */
  ax?: number;
  /** Settled body turn, radians (+ = toward the viewer's right). */
  yaw: number;
  /** 0..1 weights of the effects drawn beside him in this slot. */
  fx?: Record<string, number>;
  /** Stand on the hero's glossy floor (draw his reflection there). */
  floor?: boolean;
}

/** One slot as the page read it this frame (viewport px). */
export interface SlotSample {
  id: string;
  rect: Box;
  pose: Pose;
}

export interface Blend {
  /** Feet point, viewport px. */
  x: number;
  y: number;
  heightPx: number;
  yaw: number;
  /** 0 = dissolved (phones, between two slots), 1 = all there. */
  presence: number;
  /** Effect weights, already weighted by how present each slot is. */
  fx: Record<string, number>;
  /** The slot with the most weight (index into the samples), −1 with none. */
  active: number;
  /** Its normalised weight, 0..1. */
  share: number;
  floor: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a || 1), 0, 1);
  return t * t * (3 - 2 * t);
};

/** A slot's pull for a centre at viewport y (px). */
export function slotWeight(centreY: number, vpH: number): number {
  const d = (centreY - vpH / 2) / Math.max(1, vpH);
  return Math.exp(-((d / SIGMA) ** 2));
}

/** Where he stands in one slot: feet on its floor, as tall as the pose fits. */
export function poseInSlot(r: Box, p: Pose): { x: number; y: number; heightPx: number } {
  const heightPx = Math.max(0, Math.min(r.height * p.fit, r.width / (p.fitW ?? 0.85)));
  return { x: r.left + r.width * (p.ax ?? 0.5), y: r.top + r.height, heightPx };
}

/**
 * The target pose for this frame. Slots with no box are ignored; with no
 * slot at all he waits mid-screen. `phone` dissolves him while the weight is
 * split, so he never shows through copy on a narrow screen.
 */
export function blendSlots(samples: SlotSample[], vpW: number, vpH: number, phone: boolean): Blend {
  // Log weights, normalised against the nearest slot: the same Gaussian
  // blend, but it never underflows, so a long stretch far from every slot
  // still hands over continuously (a "hold the nearest" fallback jumped).
  const lw: number[] = [];
  let best = -1;
  for (let i = 0; i < samples.length; i++) {
    const r = samples[i].rect;
    const ok = r.width > 1 && r.height > 1;
    const d = (r.top + r.height / 2 - vpH / 2) / Math.max(1, vpH) / SIGMA;
    lw.push(ok ? -(d * d) : -Infinity);
    if (ok && (best < 0 || lw[i] > lw[best])) best = i;
  }
  if (best < 0) {
    return { x: vpW / 2, y: vpH * 0.6, heightPx: 160, yaw: 0, presence: 0, fx: {}, active: -1, share: 0, floor: false };
  }
  const ws = lw.map((v) => Math.exp(v - lw[best]));
  let sum = 0;
  for (const w of ws) sum += w;
  let x = 0, y = 0, h = 0, sy = 0, cy = 0;
  const fx: Record<string, number> = {};
  for (let i = 0; i < samples.length; i++) {
    const k = ws[i] / sum;
    if (k === 0) continue;
    const s = samples[i];
    const p = poseInSlot(s.rect, s.pose);
    x += p.x * k;
    y += p.y * k;
    h += p.heightPx * k;
    sy += Math.sin(s.pose.yaw) * k;
    cy += Math.cos(s.pose.yaw) * k;
    for (const [id, v] of Object.entries(s.pose.fx ?? {})) fx[id] = (fx[id] ?? 0) + v * k;
  }
  const share = ws[best] / sum;
  // Phones: all there only when one slot clearly holds him, and then exactly
  // in that slot (a blend would pull a visible Beamy over the copy between
  // two slots; he crosses that stretch dissolved instead).
  const presence = phone ? smoothstep(0.66, 0.9, share) : 1;
  if (phone) {
    const p = poseInSlot(samples[best].rect, samples[best].pose);
    x = p.x;
    y = p.y;
    h = p.heightPx;
  }
  return {
    x, y, heightPx: h,
    yaw: Math.atan2(sy, cy),
    presence, fx, active: best, share,
    floor: samples[best].pose.floor === true && share > 0.9,
  };
}

/** Frame-rate-independent approach: cur → target at rate k (per second). */
export function damp(cur: number, target: number, k: number, dt: number): number {
  return cur + (target - cur) * (1 - Math.exp(-k * clamp(dt, 0, DT_MAX)));
}

/** The same for an angle, the short way round. */
export function dampAngle(cur: number, target: number, k: number, dt: number): number {
  let d = (target - cur) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return cur + d * (1 - Math.exp(-k * clamp(dt, 0, DT_MAX)));
}

/**
 * Smooth-follow step for the stage: exponential approach with a velocity cap,
 * so a fast fling of the page becomes a quick glide instead of a jump.
 */
export function followStep(pos: Pt, target: Pt, dt: number, maxSpeed: number, rate = K_POS): Pt {
  const k = 1 - Math.exp(-rate * clamp(dt, 0, DT_MAX));
  let dx = (target.x - pos.x) * k;
  let dy = (target.y - pos.y) * k;
  const step = Math.hypot(dx, dy);
  const cap = maxSpeed * clamp(dt, 0, DT_MAX);
  if (step > cap && step > 0) { dx *= cap / step; dy *= cap / step; }
  return { x: pos.x + dx, y: pos.y + dy };
}

/* ── The glide: how the stage follows the blend ───────────────────────── */

/** The longest frame the glide integrates (a stall resumes, never teleports). */
export const GLIDE_DT_MAX = 0.1;
/** A target that moves further than this in one 30 fps frame (viewport heights) jumped (a longer frame allows proportionally more). */
export const JUMP_VH = 0.35;
/** Further than this from the target (viewport heights): snap, do not fly across. */
export const SNAP_VH = 1;

export interface GlidePt { x: number; y: number; h: number; }

/**
 * One frame of the stage's follow. The blend is a continuous function of
 * the scroll, so its frame-to-frame change is fed straight through (feed-
 * forward): while the page scrolls he moves exactly with his slot, with no
 * lag to drift out of. Only what is left over (a resize, a phone hand-over,
 * a jump) is eased, 1 − exp(−k·dt) with dt up to GLIDE_DT_MAX. A one-frame
 * move bigger than JUMP_VH is a discontinuity (eased, not fed through); a
 * gap over SNAP_VH, or `snap` (he is dissolved), lands him at once.
 */
export function glideStep(cur: GlidePt, prev: GlidePt | null, target: GlidePt, dt: number, vpH: number, k = K_POS, snap = false): GlidePt {
  if (snap) return { ...target };
  let { x, y, h } = cur;
  // A slow device scrolls further per frame: the limit grows with the frame (to 250 ms).
  const jump = JUMP_VH * vpH * Math.max(1, clamp(dt, 0, 0.25) * 30);
  if (prev !== null && Math.hypot(target.x - prev.x, target.y - prev.y) <= jump) {
    x += target.x - prev.x;
    y += target.y - prev.y;
    h += target.h - prev.h;
  }
  if (Math.hypot(target.x - x, target.y - y) > SNAP_VH * vpH) return { ...target };
  const a = 1 - Math.exp(-k * clamp(dt, 0, GLIDE_DT_MAX));
  return { x: x + (target.x - x) * a, y: y + (target.y - y) * a, h: Math.max(0, h + (target.h - h) * a) };
}

/* ── The stage's pixel budget ────────────────────────────────────────── */

/** Below this (frames a second, over one second) the stage drops resolution. */
export const DPR_LOW_FPS = 45;
/** Above this for DPR_CALM_S seconds in a row it earns some back. */
export const DPR_HIGH_FPS = 56;
export const DPR_CALM_S = 4;
export const DPR_STEP = 0.25;

/**
 * One second's verdict on the canvas resolution: a slow second steps it
 * down at once (never under 1); only a run of calm seconds steps it back up
 * (never over the cap), so it cannot oscillate frame to frame.
 */
export function governDpr(cur: number, fps: number, cap: number, calm: number): { dpr: number; calm: number } {
  if (fps < DPR_LOW_FPS) return { dpr: Math.max(1, Math.round((cur - DPR_STEP) * 100) / 100), calm: 0 };
  if (fps <= DPR_HIGH_FPS) return { dpr: cur, calm: 0 };
  const c = calm + 1;
  if (c >= DPR_CALM_S && cur < cap) return { dpr: Math.min(cap, Math.round((cur + DPR_STEP) * 100) / 100), calm: 0 };
  return { dpr: cur, calm: c };
}

/* ── The pinned story ─────────────────────────────────────────────────── */

/** The story section's height in vh for n steps (desktop 85vh a step, phones 75vh). */
export function storyHeightVh(n: number, phone: boolean): number {
  return n * (phone ? 75 : 85) + 100;
}

/** Progress through a pinned section, 0..1, from its viewport top and height. */
export function pinProgress(top: number, height: number, vpH: number): number {
  return clamp(-top / Math.max(1, height - vpH), 0, 1);
}

/** The active step for a progress (the last step holds at 1). */
export function storyStep(progress: number, n: number): number {
  return clamp(Math.floor(progress * n), 0, Math.max(0, n - 1));
}

/**
 * Phones: where each story step's snap anchor sits inside the pinned section
 * (px from the section's top). A native momentum flick on a phone easily
 * travels further than one step's 75vh stretch, so it could fly from step 1
 * past step 2 into step 3; with `scroll-snap-stop: always` on these anchors
 * the browser stops a swipe at the next step, every time (mandatory snapping,
 * on only inside the pinned stretch: storySnapOn). Anchor k sits where
 * the page reads the middle of step k: aligned to the viewport's top (snap
 * start, no scroll padding), the section's top is at `-a`, so the page's
 * `pinProgress(-a - headerH, h, vpH - headerH)` is exactly (k + 0.5) / n.
 */
export function storySnapOffsets(n: number, sectionH: number, vpH: number, headerH: number): number[] {
  const run = Math.max(1, sectionH - (vpH - headerH));
  return Array.from({ length: Math.max(0, n) }, (_, k) => ((k + 0.5) / n) * run - headerH);
}

/** The pinned stretch's two ends as snap anchors (progress 0 and 1), so a swipe can always leave the story. */
export function storyEdgeOffsets(sectionH: number, vpH: number, headerH: number): [number, number] {
  const run = Math.max(1, sectionH - (vpH - headerH));
  return [-headerH, run - headerH];
}

/**
 * Snapping is on only strictly inside the pinned stretch (its top above the
 * header line and its bottom below the fold). At either end, and anywhere
 * else on the page, scrolling is free: mandatory snapping with nothing ahead
 * would otherwise hold the visitor in place.
 */
export function storySnapOn(top: number, bottom: number, headerH: number, vpH: number): boolean {
  return top < headerH - 1 && bottom > vpH + 1;
}

/* ── The story pager (touch screens) ─────────────────────────────────────
   Phones used to rely on mandatory CSS snapping inside the pinned story,
   which (measured with real CDP touch gestures at 390px) snapped every slow
   drag back to the same step (a 75vh step needs a >half-screen drag) and let
   a flick that began outside the story fly past steps (snapping was still
   off when the flick started). The page now drives a touch inside the
   pinned stretch itself: the content tracks the finger 1:1, and on release
   it settles on the next or previous step, never further; at either end the
   swipe is handed back to the native scroll, so it leaves the story cleanly. */

/** A finger travel (px) or release speed (px/ms) that turns the step. */
export const SWIPE_MIN_PX = 28;
export const SWIPE_MIN_V = 0.3;

/** Does a swipe this way, from this step, leave the story (back before step 1, on past the last)? `dy` = finger travel, up < 0. */
export function storySwipeLeaves(startStep: number, n: number, dy: number): boolean {
  return (startStep <= 0 && dy > 0) || (startStep >= n - 1 && dy < 0);
}

/**
 * Where one touch swipe inside the pinned story settles: one step on (finger
 * up, dy < 0) or back (dy > 0), never more; a short, slow touch stays on its
 * step; past either end, 'leave'. `vy` = release speed, px/ms, signed like dy.
 */
export function storySwipe(startStep: number, n: number, dy: number, vy: number): number | 'leave' {
  const dir = Math.abs(dy) >= SWIPE_MIN_PX ? Math.sign(dy) : Math.abs(vy) >= SWIPE_MIN_V ? Math.sign(vy) : 0;
  if (dir === 0) return clamp(startStep, 0, Math.max(0, n - 1));
  const k = startStep - dir;
  return k < 0 || k > n - 1 ? 'leave' : k;
}

/**
 * A scroll the pager did not drive (native momentum from outside the story)
 * just crossed into the pinned stretch: catch it on the first step (coming
 * down) or the last (coming up), so a flick never flies past a step. `a0`/`a1`
 * = the stretch's ends in the scroller's own scrollTop.
 */
export function storyEntry(prevTop: number, top: number, a0: number, a1: number): 'first' | 'last' | null {
  if (prevTop <= a0 + 1 && top > a0 + 1) return 'first';
  if (prevTop >= a1 - 1 && top < a1 - 1) return 'last';
  return null;
}

/** Header progress: how far down the page, 0..1. */
export function pageProgress(scrollY: number, docH: number, vpH: number): number {
  return clamp(scrollY / Math.max(1, docH - vpH), 0, 1);
}

/** The colour journey at this frame: each section's night, weighted like the slots. */
export function weightedNight(sections: { top: number; height: number; night: number }[], vpH: number): number {
  let sum = 0;
  let v = 0;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    // A section's pull is its own body crossing the viewport centre (a tall
    // pinned section holds it the whole way through).
    const c = vpH / 2;
    const d = c < s.top ? s.top - c : c > s.top + s.height ? c - s.top - s.height : 0;
    const w = Math.exp(-((d / Math.max(1, vpH) / SIGMA) ** 2));
    sum += w;
    v += w * s.night;
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best < 0) return 0;
  return sum < 1e-6 ? sections[best].night : v / sum;
}
