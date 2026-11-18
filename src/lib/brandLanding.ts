/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The candidate landing at /beamy (brand v2) — pure logic and copy, no React.
 *
 * One viewport, six sections, moved through one at a time (never a document
 * scroll). Everything here is decision logic the page calls from its event
 * handlers, kept pure so node-env tests can hold it:
 *
 *   • the section state machine (next / back / jump, clamped),
 *   • input → navigation decisions (keys, a debounced wheel, swipes),
 *   • which reaction Beamy uses for a high-profile moment (seeded, never the
 *     same action twice in a row; routine navigation gets none),
 *   • the poke streak (escalates on repeated clicks, then resets),
 *   • the drag-to-spin physics (inertia, then a springy settle to front),
 *   • the page's copy, including the free-plan facts DERIVED from plans.ts so
 *     the page cannot promise a limit the product does not have.
 */
import { ENTITLEMENTS, formatPostCap, formatRetention } from './plans';
import { BETA_FREE, pricingCopy } from './beta';

/* ── Sections ──────────────────────────────────────────────────────────── */

export type SectionId = 'intro' | 'pick' | 'try' | 'magic' | 'how' | 'start';

export interface Section { id: SectionId; label: string; }

export const SECTIONS: Section[] = [
  { id: 'intro', label: 'Hello' },
  { id: 'pick', label: 'For you' },
  { id: 'try', label: 'Try it' },
  { id: 'magic', label: '3D magic' },
  { id: 'how', label: 'How it works' },
  { id: 'start', label: 'Start' },
];

export const LAST_SECTION = SECTIONS.length - 1;

export function clampSection(i: number): number {
  if (!Number.isFinite(i)) return 0;
  return Math.min(LAST_SECTION, Math.max(0, Math.round(i)));
}

export function sectionIndex(id: SectionId): number {
  return SECTIONS.findIndex((s) => s.id === id);
}

export type Nav = 'next' | 'back' | 'first' | 'last';

/** Where a navigation intent lands from `from` (always a valid index). */
export function navigate(from: number, nav: Nav): number {
  switch (nav) {
    case 'next': return clampSection(from + 1);
    case 'back': return clampSection(from - 1);
    case 'first': return 0;
    case 'last': return LAST_SECTION;
  }
}

/* ── Input decisions ───────────────────────────────────────────────────── */

/**
 * A keydown → a navigation intent, or null to leave the key alone.
 * `inField` = focus is in a text field (never steal its arrows); `onControl`
 * = focus is on a button/link, whose own Enter/Space must win.
 */
export function keyToNav(key: string, inField: boolean, onControl: boolean): Nav | null {
  if (inField) return null;
  switch (key) {
    case 'ArrowRight': case 'ArrowDown': case 'PageDown': return 'next';
    case 'ArrowLeft': case 'ArrowUp': case 'PageUp': return 'back';
    case 'Home': return 'first';
    case 'End': return 'last';
    case 'Enter': return onControl ? null : 'next';
    default: return null;
  }
}

export interface WheelState { accum: number; lockedUntil: number; lastAt: number; }
export const WHEEL_IDLE: WheelState = { accum: 0, lockedUntil: 0, lastAt: 0 };
/** Accumulated |deltaY| (px) that counts as one deliberate flick. */
export const WHEEL_THRESHOLD = 60;
/** After a move, ignore the trackpad's inertia tail for at least this long. */
export const WHEEL_COOLDOWN_MS = 900;
/** A pause longer than this starts a fresh gesture. */
export const WHEEL_GAP_MS = 220;

/**
 * One wheel event → maybe one section move. Trackpads fire dozens of events
 * per flick and keep firing during their inertia, so: accumulate until the
 * threshold, move once, then swallow everything for the cooldown.
 */
export function wheelDecision(s: WheelState, deltaY: number, now: number): { nav: Nav | null; state: WheelState } {
  // Still inside the cooldown: a tail that keeps streaming extends the lock
  // until the gesture actually pauses, so one long flick is still one move.
  if (now < s.lockedUntil) {
    return { nav: null, state: { accum: 0, lockedUntil: Math.max(s.lockedUntil, now + WHEEL_GAP_MS), lastAt: now } };
  }
  const fresh = now - s.lastAt > WHEEL_GAP_MS;
  const base = fresh || Math.sign(deltaY) !== Math.sign(s.accum) ? 0 : s.accum;
  const accum = base + deltaY;
  if (Math.abs(accum) >= WHEEL_THRESHOLD) {
    return { nav: accum > 0 ? 'next' : 'back', state: { accum: 0, lockedUntil: now + WHEEL_COOLDOWN_MS, lastAt: now } };
  }
  return { nav: null, state: { accum, lockedUntil: s.lockedUntil, lastAt: now } };
}

/** Minimum swipe travel (px) along the dominant axis. */
export const SWIPE_MIN_PX = 56;

/** A finished touch drag → maybe a move. Up or left = next. Slow drags (reading) do nothing. */
export function swipeDecision(dx: number, dy: number, ms: number): Nav | null {
  if (ms > 800) return null;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < SWIPE_MIN_PX) return null;
  if (ay >= ax * 1.2) return dy < 0 ? 'next' : 'back';
  if (ax >= ay * 1.2) return dx < 0 ? 'next' : 'back';
  return null;
}

/* ── Beamy's reactions ─────────────────────────────────────────────────── */

/** The high-profile moments that earn a reaction. Navigation is not one. */
export type Moment = 'intro' | 'pick' | 'snap' | 'reveal' | 'nav';

export type Reaction =
  | 'none'
  | 'wave'          // intro hello
  | 'hop'           // intro, alternative
  | 'handSparkle'   // raise a hand, light drifts to the chosen card
  | 'handBeam'      // a thin beam from the raised hand
  | 'walk'          // walk over and tap (rare)
  | 'mouthBeam'     // the signature BeamyBlast
  | 'mouthSparks'   // prop reveal: sparks from the mouth
  | 'handSparks';   // prop reveal: sparks from the raised hand

const MOMENT_OPTIONS: Record<Moment, { r: Reaction; w: number }[]> = {
  intro: [{ r: 'wave', w: 0.7 }, { r: 'hop', w: 0.3 }],
  pick: [{ r: 'handSparkle', w: 0.55 }, { r: 'handBeam', w: 0.3 }, { r: 'walk', w: 0.15 }],
  snap: [{ r: 'mouthBeam', w: 0.7 }, { r: 'handBeam', w: 0.3 }],
  reveal: [{ r: 'mouthSparks', w: 0.6 }, { r: 'handSparks', w: 0.4 }],
  nav: [{ r: 'none', w: 1 }],
};

/**
 * Pick the reaction for a moment. `r` ∈ [0,1) is the random draw; `last` is
 * the previous reaction, which is never chosen again for a high-profile
 * moment (each has at least two options, so there is always one left).
 */
export function pickReaction(moment: Moment, last: Reaction | null, r: number): Reaction {
  if (moment === 'nav') return 'none';
  const opts = MOMENT_OPTIONS[moment].filter((o) => o.r !== last);
  const total = opts.reduce((a, o) => a + o.w, 0);
  let x = Math.min(0.999999, Math.max(0, r)) * total;
  for (const o of opts) {
    if (x < o.w) return o.r;
    x -= o.w;
  }
  return opts[opts.length - 1].r;
}

/** mulberry32: a tiny seeded PRNG, so a reaction sequence is reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stateful picker over a seed: deterministic, never repeats back to back. */
export function createReactionPicker(seed: number): (moment: Moment) => Reaction {
  const rand = seededRandom(seed);
  let last: Reaction | null = null;
  return (moment) => {
    const r = pickReaction(moment, last, rand());
    if (r !== 'none') last = r;
    return r;
  };
}

/** Celebration clips after a beam lands; never the same twice in a row. */
export const CELEBRATIONS = ['Dance', 'Hop', 'ShadesOn', 'SideEye'] as const;
export type Celebration = (typeof CELEBRATIONS)[number];

export function pickCelebration(last: Celebration | null, r: number): Celebration {
  const opts = CELEBRATIONS.filter((c) => c !== last);
  return opts[Math.min(opts.length - 1, Math.floor(Math.max(0, r) * opts.length))];
}

/* ── Poke streak ───────────────────────────────────────────────────────── */

export type PokeLevel = 'sparkle' | 'burst' | 'party';
export interface PokeState { count: number; lastAt: number; }
export const POKE_IDLE: PokeState = { count: 0, lastAt: -Infinity };
/** Clicks closer together than this build a streak. */
export const POKE_STREAK_MS = 1400;

/**
 * One poke → the escalation level. 1-2 = sparkles, 3-4 = a light burst,
 * 5 = a party (Dance + spin), after which the streak starts over.
 */
export function pokeStep(s: PokeState, now: number): { level: PokeLevel; count: number; state: PokeState } {
  const count = now - s.lastAt <= POKE_STREAK_MS ? s.count + 1 : 1;
  const level: PokeLevel = count >= 5 ? 'party' : count >= 3 ? 'burst' : 'sparkle';
  return { level, count, state: { count: level === 'party' ? 0 : count, lastAt: now } };
}

/* ── Drag to spin ──────────────────────────────────────────────────────── */

export interface Spin { angle: number; vel: number; }
/** Radians per CSS px dragged. */
export const SPIN_PER_PX = 0.012;
const TAU = Math.PI * 2;

/** The "front" Beamy settles to: the nearest whole turn. */
export function nearestFront(angle: number): number {
  return Math.round(angle / TAU) * TAU;
}

/**
 * Advance a released spin by `dt` seconds: friction bleeds the fling, then a
 * damped spring pulls him round to the nearest front-facing angle.
 */
export function spinStep(s: Spin, dt: number): Spin {
  const h = Math.min(Math.max(dt, 0), 1 / 20);
  const target = nearestFront(s.angle);
  const k = 26;              // spring stiffness
  const c = 7.5;             // damping
  const friction = Math.abs(s.vel) > 4 ? 1.6 : 0; // fast flings coast first
  const acc = -k * (s.angle - target) - c * s.vel - friction * s.vel;
  const vel = s.vel + acc * h;
  return { angle: s.angle + vel * h, vel };
}

export function spinSettled(s: Spin): boolean {
  return Math.abs(s.angle - nearestFront(s.angle)) < 0.002 && Math.abs(s.vel) < 0.01;
}

/** Release velocity (rad/s) from the last pointer samples [px, ms]. */
export function releaseVelocity(samples: { x: number; t: number }[]): number {
  if (samples.length < 2) return 0;
  const a = samples[0];
  const b = samples[samples.length - 1];
  const dt = (b.t - a.t) / 1000;
  if (dt <= 0) return 0;
  const v = ((b.x - a.x) * SPIN_PER_PX) / dt;
  return Math.max(-30, Math.min(30, v));
}

/* ── Copy ──────────────────────────────────────────────────────────────── */

export const HERO = {
  headline: 'Welcome to your immersive photo booth',
  sub: 'Every guest phone becomes the booth. Simple.',
  primary: 'Create your free event',
  secondary: 'Try the live demo',
} as const;

/** Where "Create your free event" goes: the same target as the landing's CTA. */
export const SIGNUP_PATH = '/signup';
/** The existing pricing anchor on the current landing. */
export const PRICING_PATH = '/#pricing';

export const PICK_COPY = {
  heading: 'What applies to you?',
  sub: 'Pick one and Beamy tailors the tour.',
  skip: 'Skip',
} as const;

export const TRY_COPY = {
  heading: 'Try it right here',
  line: 'Pick a look, snap a photo, and watch Beamy beam it to the wall.',
  start: 'Start the camera',
  privacy: 'Nothing leaves your device.',
} as const;

export const MAGIC_COPY = {
  heading: '3D that follows every face',
  line: 'Crowns, shades and hats your guests wear live, in every shot.',
  again: 'Again',
} as const;

export const HOW_COPY = { heading: 'Live in three steps' } as const;

/** The demo's look pills (same four sets as the landing's in-phone pills);
 *  `kit` is a lib/demoKits id, null = the default Beam set. */
export const LOOKS: { kit: string | null; label: string }[] = [
  { kit: null, label: 'Beam' },
  { kit: 'wedding', label: 'Wedding' },
  { kit: 'christmas', label: 'Christmas' },
  { kit: 'party', label: 'Birthday' },
];

/** The Start section's facts, derived from the Free plan so they cannot drift. */
export function startFacts(): { heading: string; line: string; bullets: string[] } {
  const free = ENTITLEMENTS.free;
  const bullets = [formatPostCap(free.maxPosts, free.videoEnabled)];
  if (free.projectionMode) bullets.push('Live wall included');
  bullets.push(formatRetention(free.retentionDays));
  return {
    heading: 'Free to start',
    line: BETA_FREE ? pricingCopy(true).intro : 'No app for guests. Upgrade an event whenever you like.',
    bullets: bullets.slice(0, 3),
  };
}

export const START_COPY = {
  pricing: 'See pricing',
  signIn: 'Sign in',
} as const;

/** Footer links, matching MarketingFooter's destinations (Contact = the support dialog). */
export const FOOTER_LINKS: { label: string; to: string | null }[] = [
  { label: 'Guides', to: '/guides' },
  { label: 'Terms', to: '/terms' },
  { label: 'Privacy', to: '/privacy' },
  { label: 'Support', to: null },
];

/** Every string this module renders, for the copy-rule tests. */
export function landingCopy(): string[] {
  const s = startFacts();
  return [
    ...Object.values(HERO), ...Object.values(PICK_COPY), ...Object.values(TRY_COPY),
    ...Object.values(MAGIC_COPY), ...Object.values(HOW_COPY), ...Object.values(START_COPY),
    s.heading, s.line, ...s.bullets, ...SECTIONS.map((x) => x.label), ...FOOTER_LINKS.map((f) => f.label),
    ...LOOKS.map((l) => l.label),
  ];
}

/** Any pictographic emoji (incl. ZWJ sequences' parts and variation selector 16). */
export const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{20E3}]/u;
