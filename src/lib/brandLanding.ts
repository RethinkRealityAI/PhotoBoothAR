/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The candidate landing at /beamy (brand v2) — pure logic and copy, no React.
 *
 * A normal, natively scrolling page; Beamy travels down it with you and
 * presents each section (the scroll director is lib/beamyScroll). Everything
 * here is decision logic the page calls from its event handlers, kept pure so
 * node-env tests can hold it:
 *
 *   • which reaction Beamy uses for a high-profile moment (seeded, never the
 *     same action twice in a row; routine navigation gets none),
 *   • the poke streak (escalates on repeated clicks, then resets),
 *   • the drag-to-spin physics (inertia, then a springy settle to front),
 *   • the page's copy: the explainers and films reuse the original landing's
 *     shipped strings (lib/landingContent defaults), and every fact about
 *     plans is DERIVED from plans.ts / beta.ts so the page cannot promise a
 *     limit the product does not have.
 */
import { ENTITLEMENTS, formatPostCap, formatRetention } from './plans';
import { BETA_FREE, pricingCopy } from './beta';
import { DEFAULT_LANDING_CONTENT } from './landingContent';
import type { StopId } from './beamyScroll';

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

/** The hero, set like the owner's reference: a light lead-in and a bold payoff in one headline. */
export const HERO = {
  eyebrow: 'Every guest phone becomes the booth',
  lead: 'Welcome to your',
  strong: 'immersive booth',
  sub: 'Guests scan, snap in AR, and every shot beams to your live wall.',
  primary: 'Create your free event',
  /** The same action where the phone header has no room for the full label. */
  primaryShort: 'Start free',
  secondary: 'Try the live demo',
} as const;

/** The headline as one string (screen readers, titles, the type specimen). */
export const HERO_HEADLINE = `${HERO.lead} ${HERO.strong}`;

/** The sticky header's anchors: stops on this page. */
export const NAV_LINKS: { label: string; stop: StopId }[] = [
  { label: 'Demo', stop: 'try' },
  { label: 'How it works', stop: 'how' },
  { label: 'Pricing', stop: 'pricing' },
];

export const WALL_LABEL = 'Live wall';

/** Where "Create your free event" goes: the same target as the landing's CTA. */
export const SIGNUP_PATH = '/signup';

/**
 * The explainers right after the hero: the original landing's three
 * "How it works" cards (its heading line, split, and the shipped step copy),
 * which Beamy beams in one by one.
 */
export const EXPLAIN_COPY = {
  heading: 'From sign-up to a wall full of moments',
  sub: 'Three steps, no app, no queue.',
  line: 'Here’s the whole idea, in three beams.',
} as const;
export const EXPLAIN_STEPS: { title: string; body: string }[] = DEFAULT_LANDING_CONTENT.howSteps.map((s) => ({ title: s.title, body: s.body }));

export type FilmId = 'booth' | 'wall' | 'challenges' | 'cards';
/**
 * The four feature films, with the original landing's eyebrow, title and ONE
 * hook each (the films carry the detail as in-video callouts, so the copy
 * never pre-states them), plus what Beamy says while he projects each one.
 */
export const FILMS: { id: FilmId; eyebrow: string; title: string; line: string; beamy: string }[] = (
  [
    ['booth', 'Watch this. Every phone becomes the booth.'],
    ['wall', 'And this is where every shot lands.'],
    ['challenges', 'Want the room to mingle? Give them a mission.'],
    ['cards', 'And the next morning, everyone gets a keepsake.'],
  ] as const
).map(([id, beamy]) => {
  const f = DEFAULT_LANDING_CONTENT.features.find((x) => x.id === id);
  return { id, eyebrow: f?.eyebrow ?? '', title: f?.title ?? '', line: f?.copy ?? '', beamy };
});

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

export interface PlanCard { name: string; price: string; unit: string; blurb: string; features: string[]; popular?: boolean; }

/**
 * The original landing's plan cards, reproduced fact for fact (Landing.tsx
 * TIERS — a drift test reads that file and fails if any price or line here is
 * not also there). Limits are formatted from ENTITLEMENTS exactly as it does.
 */
export function planCards(): PlanCard[] {
  const E = ENTITLEMENTS;
  return [
    {
      name: 'Free', price: '$0', unit: 'to try it', blurb: 'Spin up a booth and see the magic.',
      features: [
        '1 live event', 'Photo booth + live wall', formatPostCap(E.free.maxPosts, E.free.videoEnabled),
        formatRetention(E.free.retentionDays), '3 free AI frames per event', 'Small Beamwall watermark on photos',
      ],
    },
    {
      name: 'Essentials', price: '$49', unit: 'per event', blurb: 'Everything a small celebration needs.',
      features: [
        formatPostCap(E.essentials.maxPosts, E.essentials.videoEnabled), 'Video capture', 'No watermark',
        formatRetention(E.essentials.retentionDays), '+20 AI credits',
      ],
    },
    {
      name: 'Premium', price: '$99', unit: 'per event', blurb: 'The full experience, cards included.',
      features: [
        formatPostCap(E.premium.maxPosts, E.premium.videoEnabled), 'Keepsake cards',
        formatRetention(E.premium.retentionDays), 'Priority support', '+100 AI credits',
      ],
      popular: true,
    },
    {
      name: 'Deluxe', price: '$169', unit: 'per event', blurb: 'A keepsake film, and every finishing touch.',
      features: [
        'Everything in Premium', 'Keepsake highlight film', 'Premium card renders',
        formatRetention(E.deluxe.retentionDays), '+130 AI credits',
      ],
    },
  ];
}

/** The pricing section's words: the landing's own (beta-aware) heading, intro and CTAs, plus its Pro line. */
export function pricingSection(): { heading: string; intro: string; pro: string; cta: (tier: string) => string; recommended: string; line: string } {
  const p = pricingCopy(BETA_FREE);
  return {
    heading: p.heading,
    intro: p.intro,
    pro: 'Frequent host? Beamwall Pro is $79/month — Premium on every event, plus 300 AI credits a month.',
    cta: p.cta,
    recommended: 'Recommended',
    line: 'Start free. Upgrade only the events that need it.',
  };
}

export const START_COPY = {
  signIn: 'Sign in',
  skipIntro: 'Skip intro',
  skipShort: 'Skip',
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
  const pr = pricingSection();
  return [
    ...Object.values(HERO), HERO_HEADLINE, WALL_LABEL, ...NAV_LINKS.map((n) => n.label),
    ...Object.values(EXPLAIN_COPY), ...EXPLAIN_STEPS.flatMap((x) => [x.title, x.body]),
    ...FILMS.flatMap((f) => [f.eyebrow, f.title, f.line, f.beamy]),
    ...Object.values(PICK_COPY), ...Object.values(TRY_COPY),
    ...Object.values(MAGIC_COPY), ...Object.values(HOW_COPY), ...Object.values(START_COPY),
    s.heading, s.line, ...s.bullets, ...FOOTER_LINKS.map((f) => f.label),
    ...LOOKS.map((l) => l.label),
    pr.heading, pr.intro, pr.pro, pr.recommended, pr.line,
    ...planCards().flatMap((t) => [t.name, t.price, t.unit, t.blurb, ...t.features, pr.cta(t.name)]),
  ];
}

/** Any pictographic emoji (incl. ZWJ sequences' parts and variation selector 16). */
export const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{20E3}]/u;
