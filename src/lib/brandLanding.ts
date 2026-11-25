/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The candidate landing at /beamy (brand v2) — pure logic and copy, no React.
 *
 * A normal, natively scrolling page; Beamy travels down it with you and
 * glides between the sections' slots (the slot/pose glide is lib/beamyScroll). Everything
 * here is decision logic the page calls from its event handlers, kept pure so
 * node-env tests can hold it:
 *
 *   • which reaction Beamy uses for a high-profile moment (seeded, never the
 *     same action twice in a row; routine navigation gets none),
 *   • the poke streak (escalates on repeated clicks, then resets),
 *   • the drag-to-spin physics (inertia, then a springy settle to front),
 *   • the page's copy: the films reuse the original landing's
 *     shipped strings (lib/landingContent defaults), and every fact about
 *     plans is DERIVED from plans.ts / beta.ts so the page cannot promise a
 *     limit the product does not have.
 */
import { ENTITLEMENTS, FAIR_USE_LINE, formatPostCap, formatRetention, formatVideoLength } from './plans';
import { BETA_FREE, pricingCopy } from './beta';
import { DEFAULT_LANDING_CONTENT } from './landingContent';
import type { StopId } from './beamyScroll';
import { VC_COPY } from './beamyVirtual';

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

/* ── The party spin (a tap reaction: he spins, then settles to front) ──── */

export interface Spin { angle: number; vel: number; }
const TAU = Math.PI * 2;

/** The "front" Beamy settles to: the nearest whole turn. */
export function nearestFront(angle: number): number {
  return Math.round(angle / TAU) * TAU;
}

/**
 * Advance a spin by `dt` seconds: friction bleeds the fling, then a
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

/* ── Copy ──────────────────────────────────────────────────────────────── */

/**
 * The hero, set like the owner's reference: a light lead-in and a bold
 * payoff in one headline (the payoff is SET in capitals by CSS; the copy
 * stays lower case so screen readers say words, not letters), then the
 * promise, then three beats. Nothing sits above the headline.
 */
export const HERO = {
  lead: 'Welcome to your',
  strong: 'immersive booth',
  line: 'Every guest phone becomes the booth',
  sub: 'Scan. Snap. Beam.',
  /** Says it is virtual, not a machine that ships (owner, 2026-11-25). */
  note: 'A virtual photo booth. Think Snapchat and Instagram. In your browser, no sign-in needed.',
  primary: 'Create your free event',
  /** The same action where the phone header has no room for the full label. */
  primaryShort: 'Start free',
  secondary: 'Try the live demo',
} as const;

/** The headline as one string (screen readers, titles, the type specimen). */
export const HERO_HEADLINE = `${HERO.lead} ${HERO.strong}`;

/** The sticky header's anchors: stops on this page. */
export const NAV_LINKS: { label: string; stop: StopId }[] = [
  { label: 'How it works', stop: 'story' },
  { label: 'Demo', stop: 'try' },
  { label: 'Pricing', stop: 'pricing' },
];

export const WALL_LABEL = 'Live wall';

/** Where "Create your free event" goes: the same target as the landing's CTA. */
export const SIGNUP_PATH = '/signup';

/**
 * The pinned story right after the hero: six glass cards, one at a time,
 * each driving Beamy (his turn and clip) and ONE 3D effect drawn beside him
 * in the canvas (`fx`). Short on purpose: a title and one line each.
 */
export const STORY_COPY = {
  eyebrow: 'How it works',
  heading: 'One scan, a whole night of moments',
} as const;

/**
 * When and how guests get their keepsake: the ONE place this promise lives,
 * so the owner's final wording is a one-line swap. Kept honest to what ships:
 * the keepsake autopilot (send-keepsakes `due`/`finish` + the hourly film job)
 * emails every opted-in guest their album the morning after, and only PAID
 * events get the film, so the line says both (owner-approved 2026-11-21).
 */
export const KEEPSAKE_PROMISE = {
  /** The How it works step body (80 chars max, no dashes). */
  step: 'Next morning, guests get a digital album by email, and a film on paid plans.',
  /** What Beamy says over the keepsake film (his speech bubble on its tab). */
  beamy: 'Aww, I’m keeping this one forever.',
} as const;

export type StoryFxId = 'qr' | 'prop' | 'wall' | 'medal' | 'keepsake' | 'virtual';
export type StoryClip = 'Wave' | 'Hop' | 'BeamyBlast' | 'Dance' | 'ShadesOn';

export const STORY_STEPS: { id: StoryFxId; title: string; body: string; clip: StoryClip; yaw: number }[] = [
  { id: 'qr', title: 'Guests scan a QR code', body: 'Their own phone becomes your booth. No app, no sign-in.', clip: 'Wave', yaw: 0.55 },
  { id: 'prop', title: 'They dress up in augmented reality (AR)', body: 'Frames, filters and 3D props in your colours, tracked on every face.', clip: 'ShadesOn', yaw: 0.45 },
  { id: 'wall', title: 'Every shot beams to your wall', body: 'Photos land on the live wall the moment they are taken.', clip: 'BeamyBlast', yaw: 0.6 },
  { id: 'medal', title: 'Challenges keep it going', body: 'Missions and points get the whole room mingling.', clip: 'Dance', yaw: 0.35 },
  { id: 'keepsake', title: 'Everyone gets a digital keepsake', body: KEEPSAKE_PROMISE.step, clip: 'Hop', yaw: 0.5 },
  // Virtual celebrations (lib/beamyVirtual owns the words and what really ships).
  { id: 'virtual', title: VC_COPY.title, body: VC_COPY.body, clip: 'Wave', yaw: 0.4 },
];

export const FILMS_COPY = {
  heading: 'See it in motion',
} as const;

/** This page's own wording of a film hook, where the shared default reads machine-written. */
const FILM_LINE: Partial<Record<string, string>> = {
  booth: 'One scan drops every guest into a magical booth, right in their browser.',
};
/** This page's own film tab label, where the shared default could read as a physical product. */
export const FILM_EYEBROW: Partial<Record<string, string>> = {
  cards: 'Digital keepsakes',
};

export type FilmId = 'booth' | 'wall' | 'challenges' | 'cards';
/**
 * The four feature films, with the original landing's eyebrow, title and ONE
 * hook each (the films carry the detail as in-video callouts, so the copy
 * never pre-states them), plus Beamy's speech-bubble line on each tab.
 */
export const FILMS: { id: FilmId; eyebrow: string; title: string; line: string; beamy: string }[] = (
  [
    ['booth', 'I hope I’m catching my good angle.'],
    ['wall', 'That’s me, third row, waving.'],
    ['challenges', 'I’m very competitive. I would definitely win this.'],
    ['cards', KEEPSAKE_PROMISE.beamy],
  ] as const
).map(([id, beamy]) => {
  const f = DEFAULT_LANDING_CONTENT.features.find((x) => x.id === id);
  return { id, eyebrow: FILM_EYEBROW[id] ?? f?.eyebrow ?? '', title: f?.title ?? '', line: FILM_LINE[id] ?? f?.copy ?? '', beamy };
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
        formatPostCap(E.essentials.maxPosts, E.essentials.videoEnabled), formatVideoLength(E.essentials.videoMaxSec), 'No watermark',
        formatRetention(E.essentials.retentionDays), '+20 AI credits',
      ],
    },
    {
      name: 'Premium', price: '$99', unit: 'per event', blurb: 'The full experience, cards included.',
      features: [
        formatPostCap(E.premium.maxPosts, E.premium.videoEnabled), formatVideoLength(E.premium.videoMaxSec), 'Keepsake cards',
        formatRetention(E.premium.retentionDays), 'Priority support', '+100 AI credits',
      ],
      popular: true,
    },
    {
      name: 'Deluxe', price: '$169', unit: 'per event', blurb: 'A keepsake film, and every finishing touch.',
      features: [
        'Everything in Premium', formatVideoLength(E.deluxe.videoMaxSec), 'Keepsake highlight film', 'Premium card renders',
        formatRetention(E.deluxe.retentionDays), '+130 AI credits',
      ],
    },
  ];
}

/**
 * How /beamy words a plan line that could read as a physical product (everything
 * Beamwall delivers is digital). Display only: planCards() stays fact for fact
 * with Landing.tsx, and these lines say the same thing with the word "digital".
 */
const PLAN_DIGITAL: Record<string, string> = {
  'The full experience, cards included.': 'The full experience, digital keepsakes included.',
  'Keepsake cards': 'Digital keepsake cards',
  'Premium card renders': 'Premium digital card designs',
};

/** The plan cards as /beamy shows them: planCards() with PLAN_DIGITAL's wording. */
export function beamyPlanCards(): PlanCard[] {
  const w = (s: string) => PLAN_DIGITAL[s] ?? s;
  return planCards().map((c) => ({ ...c, blurb: w(c.blurb), features: c.features.map(w) }));
}

/** The pricing section's words: the landing's own (beta-aware) heading, intro and CTAs, plus its Pro line. */
export function pricingSection(): { heading: string; intro: string; pro: string; fairUse: string; cta: (tier: string) => string; recommended: string; line: string } {
  const p = pricingCopy(BETA_FREE);
  return {
    heading: p.heading,
    // The shared beta.ts wording, with its em dash read as the sentence break it is.
    intro: p.intro.replace(/\s+—\s+(\w)/g, (_m, c: string) => `. ${c.toUpperCase()}`),
    pro: 'Frequent host? Beamwall Pro is $79/month: Premium on every event, plus 300 AI credits a month.',
    fairUse: FAIR_USE_LINE,
    cta: p.cta,
    recommended: 'Recommended',
    line: 'Start free. Upgrade only the events that need it.',
  };
}

export const START_COPY = {
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
  const pr = pricingSection();
  return [
    ...Object.values(HERO), HERO_HEADLINE, WALL_LABEL, ...NAV_LINKS.map((n) => n.label),
    ...Object.values(STORY_COPY), ...STORY_STEPS.flatMap((x) => [x.title, x.body]),
    ...Object.values(FILMS_COPY), ...FILMS.flatMap((f) => [f.eyebrow, f.title, f.line, f.beamy]),
    ...Object.values(PICK_COPY), ...Object.values(TRY_COPY), ...Object.values(START_COPY),
    s.heading, s.line, ...s.bullets, ...FOOTER_LINKS.map((f) => f.label),
    ...LOOKS.map((l) => l.label),
    pr.heading, pr.intro, pr.pro, pr.recommended, pr.line,
    ...beamyPlanCards().flatMap((t) => [t.name, t.price, t.unit, t.blurb, ...t.features, pr.cta(t.name)]),
  ];
}

/** Any pictographic emoji (incl. ZWJ sequences' parts and variation selector 16). */
export const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{20E3}]/u;
