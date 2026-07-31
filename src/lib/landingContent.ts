/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PLATFORM landing-page content: types, bundled defaults, and the total
 * normalizer that makes CMS overrides safe to render.
 *
 * NAMING — this is NOT src/types.ts `LandingContent`: that older type is the
 * per-EVENT guest "/join" page (app_settings key 'landing', slug-keyed, edited
 * in the legacy event admin). This module is the PLATFORM marketing page at
 * "/", stored in the `landing_content` singleton row (migration 030) and
 * edited at /admin/landing. No file imports both, but if one ever must,
 * import this one aliased (e.g. `PlatformLandingContent`).
 *
 * PURITY IS LOAD-BEARING: this module imports nothing (no React, no supabase,
 * no bundled assets), so its colocated test runs in vitest's node env without
 * env vars or Vite asset transforms. The I/O half is landingContentClient.ts;
 * media defaults are expressed as `undefined` = "use the bundled import",
 * which src/pages/Landing.tsx resolves against its own asset imports.
 *
 * Every read from the database flows through normalizeLandingContent — a TOTAL
 * function: whatever jsonb arrives (null, junk, hostile), the result is a
 * complete LandingContent whose every field is either a validated override or
 * the bundled default. The marketing page can therefore never render blank
 * because of a bad CMS row.
 */

/* ── Types ──────────────────────────────────────────────────────────── */

export interface LandingHeroContent {
  /** The pill above the title ("Free to start — no credit card"). */
  badge: string;
  /** Plain text before the foil span in the H1. */
  titlePre: string;
  /** The foil-gradient part of the H1. */
  titleHighlight: string;
  tagline: string;
  primaryCta: string;
  secondaryCta: string;
  /** The one line under the hero frame carousel. Deliberately makes NO claim
   *  that those photos are real event moments — the bundled defaults are
   *  AI-generated illustrations of each event type. */
  carouselCaption: string;
}

/**
 * One card in the hero frame carousel. FIXED length 6 — the strip's frame
 * designs, palettes and bundled photos are PRESENTATION (they live in
 * LiveHeroCarousel's own SLOTS table, merged with these by INDEX), so the only
 * editable parts are the event-type label and an optional photo override.
 */
export interface LandingHeroSlotContent {
  /** The event TYPE this frame is styled for ("Wedding", "Gala night", …). */
  label: string;
  /** Override for the card photo; undefined = the bundled AI illustration. */
  imageUrl?: string;
}

export interface LandingStepContent {
  title: string;
  body: string;
  /** Override for the step's cutout art; undefined = bundled default. */
  imageUrl?: string;
}

export type LandingFeatureId = 'booth' | 'wall' | 'challenges' | 'cards';

export interface LandingFeatureContent {
  id: LandingFeatureId;
  eyebrow: string;
  title: string;
  /**
   * ONE outcome sentence, then the film. It must not enumerate features and
   * must not pre-state the film's own in-video callouts — the owner's round-7
   * note was "just a nice one sentence hook then video ... it shows in the
   * videos already". The uppercase keyword strip that used to sit here (a
   * `highlights: string[]` field) is gone for that reason; do not reintroduce
   * one. Keep these under ~90 characters (asserted in landingContent.test.ts).
   */
  copy: string;
  /** Overrides; undefined = the bundled film / poster / decor art. */
  videoUrl?: string;
  posterUrl?: string;
  decorImageUrl?: string;
}

export interface LandingEventTypeContent {
  label: string;
  blurb: string;
  imageUrl?: string;
}

export interface LandingFaqContent {
  q: string;
  a: string;
}

export interface LandingClosingContent {
  title: string;
  body: string;
  cta: string;
}

export interface LandingContent {
  hero: LandingHeroContent;
  /** FIXED length 6 — the carousel duplicates this list for its seamless loop,
   *  so the node count the marquee measures depends on it. */
  heroSlots: LandingHeroSlotContent[];
  /** FIXED length 3 — the GSAP steps choreography depends on the node count. */
  howSteps: LandingStepContent[];
  /** FIXED length 4, ids booth|wall|challenges|cards in that order. */
  features: LandingFeatureContent[];
  /** FIXED length 6. */
  eventTypes: LandingEventTypeContent[];
  /** Variable (capped) — rendered as chips, container-level reveal. */
  audiences: string[];
  /** Variable, capped at 12 — native details/summary. */
  faqs: LandingFaqContent[];
  closing: LandingClosingContent;
  footerTagline: string;
}

/* ── Bundled defaults (the strings shipped in Landing.tsx today) ────── */

export const FAQ_MAX = 12;
export const AUDIENCE_MAX = 12;

export const DEFAULT_LANDING_CONTENT: LandingContent = {
  hero: {
    badge: 'Free to start — no credit card',
    // No trailing space (normalize trims): Landing.tsx joins titlePre and
    // titleHighlight with an explicit space.
    titlePre: 'Your',
    titleHighlight: 'Immersive Virtual Photobooth',
    tagline:
      'Give every guest a magical photo booth in their pocket — no app to download. Photos beam onto a live wall styled with frames and 3D magic you set up in minutes.',
    primaryCta: 'Start free',
    secondaryCta: 'Try the live demo',
    // Honest by construction: the strip shows FRAME DESIGNS over illustrative
    // photos, so the caption promises styling, never "real moments".
    carouselCaption: 'Signature frames, styled for every kind of event',
  },
  // Index order is the STRIP order, chosen so adjacent frames don't repeat a
  // palette: neon pink → classic gold → hexagon green → equalizer violet →
  // deco gold → gold border. LiveHeroCarousel's SLOTS table holds the matching
  // frame id / glow / bundled photo at the same index.
  heroSlots: [
    { label: 'Birthday' },
    { label: 'Wedding' },
    { label: 'Launch party' },
    { label: 'Conference' },
    { label: 'Gala night' },
    { label: 'Trade show' },
  ],
  howSteps: [
    {
      title: 'Create your event',
      body: 'Sign up free, pick a style, and tune your frames, effects and 3D props in the studio — minutes, not hours.',
    },
    {
      title: 'Share one QR code',
      body: 'Put your code on tables, screens or the invite. Guests scan it and they’re in — no app to download, nothing to install.',
    },
    {
      title: 'The room lights up',
      body: 'Guests snap magical photos and videos that beam onto your live wall in real time, for the whole room to watch.',
    },
  ],
  // One outcome sentence each — never a feature list, never the film's own
  // callouts restated ("Face-tracked 3D props & frames", "Cinematic live
  // effects", "Live leaderboard · on the wall", "A greeting card" all live IN
  // the films). See the note on LandingFeatureContent.copy.
  features: [
    {
      id: 'booth',
      eyebrow: 'Immersive booth',
      title: 'A photo booth that lives in every pocket',
      copy: 'One scan drops every guest into a magical booth — right in their browser.',
    },
    {
      id: 'wall',
      eyebrow: 'Live photo wall',
      title: 'Every shot beams onto the wall',
      copy: 'The moment a photo lands, the whole room turns to look.',
    },
    {
      id: 'challenges',
      eyebrow: 'Challenges',
      title: 'Turn the room into the game',
      copy: 'Give guests a mission, and watch every table race to beat it.',
    },
    {
      id: 'cards',
      eyebrow: 'Keepsake cards & guestbook',
      title: 'The morning-after keepsake',
      copy: 'Long after the lights go up, everyone still has a piece of the night.',
    },
  ],
  eventTypes: [
    { label: 'Conferences', blurb: 'Networking made playful' },
    { label: 'Trade shows & conventions', blurb: 'A booth that draws the floor' },
    { label: 'Weddings', blurb: 'Every guest, one keepsake' },
    { label: 'Galas & fundraisers', blurb: 'Black-tie, full glamour' },
    { label: 'Birthdays & parties', blurb: 'The room joins the fun' },
    { label: 'Brand activations', blurb: 'Shareable by design' },
  ],
  audiences: [
    'Event planners & organizers',
    'Corporate & marketing teams',
    'Couples & wedding parties',
    'Party hosts',
    'Venues & agencies',
  ],
  faqs: [
    {
      q: 'Do my guests need to download an app?',
      a: 'No. The booth runs right in the phone browser — guests scan your QR code and they’re in. Nothing to install.',
    },
    {
      q: 'Will it work on my guests’ phones?',
      a: 'Yes — it runs in modern mobile browsers (iOS Safari, Android Chrome). The camera stays on their device; nothing leaves it until they choose to share a photo.',
    },
    {
      q: 'How long does it take to set up?',
      a: 'Minutes. Pick a style, tweak your frames and effects in the studio, and share the QR — you can have a booth live well before your event.',
    },
    {
      q: 'What if the venue wifi is patchy?',
      a: 'The magic runs on each guest’s device, so only the finished photo needs to upload — it works on cellular data, and you moderate what hits the wall from your phone.',
    },
    {
      q: 'What does it cost?',
      a: 'Start free — one event, up to 25 photos. Paid event packages start at $49, and Beamwall Pro is $79/month for frequent hosts. You only pay for events you run.',
    },
    {
      q: 'Is our event private?',
      a: 'You control it. Guests’ captures appear on your wall by design and you can moderate or remove any of them at any time; see our Privacy Policy for the full details.',
    },
  ],
  closing: {
    title: 'Ready in minutes.',
    body: 'Create your event, pick a style, and share the QR code. Your guests bring the moments; the wall brings the magic.',
    cta: 'Create your event',
  },
  footerTagline: 'Built for weddings, galas and celebrations of every size.',
};

/* ── Media URL gate ─────────────────────────────────────────────────── */

/** Marks a Supabase public object URL (same posture as src/lib/mediaUrl.ts:
 *  do NOT pin the project hostname; recognise the storage path shape and let
 *  "being wrong" be free — an unrecognised URL falls back to the bundled
 *  asset, so nothing here can break the marketing page). */
const PUBLIC_OBJECT = '/storage/v1/object/public/';

const VIDEO_EXT_RE = /\.(mp4|webm|mov)(\?|$)/i;

/**
 * An override media URL that is safe to hand to <img>/<video> src, or
 * undefined (= use the bundled default).
 *
 * Accepts ONLY https: URLs whose pathname includes the Supabase public-object
 * prefix — this is what uploadLandingMedia produces. data:, javascript:,
 * http:, and arbitrary origins are all rejected: the CMS row is written by
 * platform admins through admin-api, but a stored-XSS-by-config is still a
 * bug class worth closing at the render boundary.
 */
export function resolveMediaUrl(candidate: unknown, kind: 'image' | 'video'): string | undefined {
  if (typeof candidate !== 'string') return undefined;
  const trimmed = candidate.trim();
  if (trimmed === '') return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:') return undefined;
  if (!url.pathname.includes(PUBLIC_OBJECT)) return undefined;
  // A video slot must point at a video file; an image slot must not. The
  // storage bucket serves whatever was uploaded, so the extension is the only
  // pre-flight signal available — and a mismatch falls back rather than fails.
  const isVideo = VIDEO_EXT_RE.test(url.pathname);
  if (kind === 'video' && !isVideo) return undefined;
  if (kind === 'image' && isVideo) return undefined;
  return trimmed;
}

/* ── The total normalizer ───────────────────────────────────────────── */

const TITLE_MAX = 200;
const BODY_MAX = 1000;
/** Generous cap for stored URLs; real validation happens in resolveMediaUrl. */
const URL_MAX = 2000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A trimmed, capped string — or the default when absent/blank/not a string.
 *  Blank-after-trim falls back deliberately: an accidentally emptied field
 *  must not blank a section of the public page. */
function str(v: unknown, fallback: string, max: number): string {
  if (typeof v !== 'string') return fallback;
  const t = v.trim();
  if (t === '') return fallback;
  return t.slice(0, max);
}

/** An optional URL-ish string: kept (trimmed/capped) when present, else
 *  undefined. Scheme/origin validation is resolveMediaUrl's job at render. */
function optionalUrl(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (t === '') return undefined;
  return t.slice(0, URL_MAX);
}

/** `{ key: value }` when defined, `{}` when not — so optional media fields are
 *  ABSENT rather than explicit `undefined`. Keeps normalize(DEFAULT) a fixed
 *  point and makes output stable across the DB's JSON round trip (stringify
 *  drops undefined-valued keys). */
function maybe<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

function normalizeHero(raw: unknown): LandingHeroContent {
  const d = DEFAULT_LANDING_CONTENT.hero;
  const r = isRecord(raw) ? raw : {};
  return {
    badge: str(r.badge, d.badge, TITLE_MAX),
    titlePre: str(r.titlePre, d.titlePre, TITLE_MAX),
    titleHighlight: str(r.titleHighlight, d.titleHighlight, TITLE_MAX),
    tagline: str(r.tagline, d.tagline, BODY_MAX),
    primaryCta: str(r.primaryCta, d.primaryCta, TITLE_MAX),
    secondaryCta: str(r.secondaryCta, d.secondaryCta, TITLE_MAX),
    carouselCaption: str(r.carouselCaption, d.carouselCaption, TITLE_MAX),
  };
}

function normalizeHeroSlots(raw: unknown): LandingHeroSlotContent[] {
  const arr = Array.isArray(raw) ? raw : [];
  // FIXED length: merge by index, never grow or shrink — the carousel's marquee
  // measures a 2× duplication of this list.
  return DEFAULT_LANDING_CONTENT.heroSlots.map((d, i) => {
    const r = isRecord(arr[i]) ? (arr[i] as Record<string, unknown>) : {};
    return {
      label: str(r.label, d.label, TITLE_MAX),
      ...maybe('imageUrl', optionalUrl(r.imageUrl)),
    };
  });
}

function normalizeSteps(raw: unknown): LandingStepContent[] {
  const arr = Array.isArray(raw) ? raw : [];
  // FIXED length: merge by index, never grow or shrink.
  return DEFAULT_LANDING_CONTENT.howSteps.map((d, i) => {
    const r = isRecord(arr[i]) ? (arr[i] as Record<string, unknown>) : {};
    return {
      title: str(r.title, d.title, TITLE_MAX),
      body: str(r.body, d.body, BODY_MAX),
      ...maybe('imageUrl', optionalUrl(r.imageUrl)),
    };
  });
}

function normalizeFeatures(raw: unknown): LandingFeatureContent[] {
  const arr = Array.isArray(raw) ? raw : [];
  // FIXED length + fixed id order: merge by id (position-independent), falling
  // back to the same index only when that entry names no other id.
  return DEFAULT_LANDING_CONTENT.features.map((d, i) => {
    const byId = arr.find((o) => isRecord(o) && o.id === d.id);
    const byIndex = isRecord(arr[i]) && (arr[i] as Record<string, unknown>).id === undefined ? arr[i] : undefined;
    const r = (byId ?? byIndex ?? {}) as Record<string, unknown>;
    // NOTE: blobs published before round 7 still carry a `highlights` array
    // here. It is simply not read — the output is built field-by-field, so the
    // key is dropped like any other unknown key (test: "an old blob that still
    // carries highlights normalizes cleanly").
    return {
      id: d.id,
      eyebrow: str(r.eyebrow, d.eyebrow, TITLE_MAX),
      title: str(r.title, d.title, TITLE_MAX),
      copy: str(r.copy, d.copy, BODY_MAX),
      ...maybe('videoUrl', optionalUrl(r.videoUrl)),
      ...maybe('posterUrl', optionalUrl(r.posterUrl)),
      ...maybe('decorImageUrl', optionalUrl(r.decorImageUrl)),
    };
  });
}

function normalizeEventTypes(raw: unknown): LandingEventTypeContent[] {
  const arr = Array.isArray(raw) ? raw : [];
  return DEFAULT_LANDING_CONTENT.eventTypes.map((d, i) => {
    const r = isRecord(arr[i]) ? (arr[i] as Record<string, unknown>) : {};
    return {
      label: str(r.label, d.label, TITLE_MAX),
      blurb: str(r.blurb, d.blurb, TITLE_MAX),
      ...maybe('imageUrl', optionalUrl(r.imageUrl)),
    };
  });
}

function normalizeAudiences(raw: unknown): string[] {
  // Variable length by design (chips) — but an ARRAY is respected as-is
  // (filtered + capped), while any non-array falls back to the defaults.
  if (!Array.isArray(raw)) return [...DEFAULT_LANDING_CONTENT.audiences];
  return raw
    .filter((a): a is string => typeof a === 'string' && a.trim() !== '')
    .map((a) => a.trim().slice(0, TITLE_MAX))
    .slice(0, AUDIENCE_MAX);
}

function normalizeFaqs(raw: unknown): LandingFaqContent[] {
  if (!Array.isArray(raw)) return DEFAULT_LANDING_CONTENT.faqs.map((f) => ({ ...f }));
  return raw
    .filter(isRecord)
    .map((r) => ({ q: str(r.q, '', TITLE_MAX), a: str(r.a, '', BODY_MAX) }))
    .filter((f) => f.q !== '' && f.a !== '')
    .slice(0, FAQ_MAX);
}

function normalizeClosing(raw: unknown): LandingClosingContent {
  const d = DEFAULT_LANDING_CONTENT.closing;
  const r = isRecord(raw) ? raw : {};
  return {
    title: str(r.title, d.title, TITLE_MAX),
    body: str(r.body, d.body, BODY_MAX),
    cta: str(r.cta, d.cta, TITLE_MAX),
  };
}

/**
 * TOTAL: any input → a complete, render-safe LandingContent. Unknown keys are
 * dropped (the output is built field-by-field, never spread from the input);
 * fixed-slot arrays keep their exact length; every string is trimmed and
 * capped; media fields survive only as optional strings that resolveMediaUrl
 * re-checks at the render boundary.
 */
export function normalizeLandingContent(raw: unknown): LandingContent {
  const r = isRecord(raw) ? raw : {};
  return {
    hero: normalizeHero(r.hero),
    heroSlots: normalizeHeroSlots(r.heroSlots),
    howSteps: normalizeSteps(r.howSteps),
    features: normalizeFeatures(r.features),
    eventTypes: normalizeEventTypes(r.eventTypes),
    audiences: normalizeAudiences(r.audiences),
    faqs: normalizeFaqs(r.faqs),
    closing: normalizeClosing(r.closing),
    footerTagline: str(r.footerTagline, DEFAULT_LANDING_CONTENT.footerTagline, TITLE_MAX),
  };
}
