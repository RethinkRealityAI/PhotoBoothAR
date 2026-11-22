/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * revealModel — Beamwall's own marketing "reveals": an email with one big
 * glowing "Reveal now" button that opens a page where Beamy guards the news
 * until the reader unlocks it (blast it, melt it, shine on it, tap, turn,
 * trace or rub). One document drives all three surfaces:
 *
 *   email   (lib/reveals/revealEmail.ts)       subject, teaser, the CTA
 *   page    (/reveal/:slug, RevealExperience)  sealed → unlock → the news
 *   editor  (/admin/reveals/:id)               edits this document
 *
 * Stored as jsonb in `marketing_reveals` (migration 052): `draft` while the
 * admin edits, `published` once it goes out. Everything a reader can see goes
 * through `normalizeRevealDoc`, which is TOTAL: any value at all (a stale row,
 * a hand-edited blob, nothing) comes back as a complete, safe document.
 *
 * Pure: no React, no supabase import, so the email renderer, the page, the
 * editor and the tests all read the same truth.
 */

/* ------------------------------------------------------------------ */
/* Unlocks: how the reader opens it                                    */
/* ------------------------------------------------------------------ */

export const REVEAL_UNLOCKS = ['blast', 'melt', 'shine', 'tap', 'turn', 'trace', 'rub'] as const;
export type RevealUnlock = typeof REVEAL_UNLOCKS[number];

export interface BeamyLines {
  /** What Beamy says when the page opens. */
  greeting: string;
  /** The instruction (also the hint pill under him). */
  hint: string;
  /** Said once the reader is part-way. `{left}` becomes what is left (taps). */
  cheer: string;
  /** Said the moment it unlocks. */
  unlocked: string;
}

export interface UnlockMeta {
  id: RevealUnlock;
  label: string;
  /** One line for the editor tile. */
  blurb: string;
  /** The gesture in two words, for the hint chip ("Tap", "Hold", ...). */
  gesture: string;
  lines: BeamyLines;
}

export const UNLOCK_META: Record<RevealUnlock, UnlockMeta> = {
  blast: {
    id: 'blast',
    label: 'Beamy blast',
    blurb: 'One tap and Beamy blasts the crystal open.',
    gesture: 'Tap Beamy',
    lines: {
      greeting: 'Psst. I have been guarding something good.',
      hint: 'Tap me and I will blast it open.',
      cheer: 'Charging up...',
      unlocked: 'Beamy blast! Ta-da.',
    },
  },
  melt: {
    id: 'melt',
    label: 'Melt the ice',
    blurb: 'Hold Beamy and his warm beam melts the ice away.',
    gesture: 'Hold Beamy',
    lines: {
      greeting: 'Brr. It is frozen solid in there.',
      hint: 'Hold me down to warm it up.',
      cheer: 'Keep going, it is melting!',
      unlocked: 'All melted. Look what was inside!',
    },
  },
  shine: {
    id: 'shine',
    label: 'Shine bright',
    blurb: 'Press and hold until Beamy glows the news into view.',
    gesture: 'Hold Beamy',
    lines: {
      greeting: 'It is a little dark in here.',
      hint: 'Press and hold me so I can shine.',
      cheer: 'Brighter... brighter...',
      unlocked: 'Lights on! There it is.',
    },
  },
  tap: {
    id: 'tap',
    label: 'Wake him up',
    blurb: 'A few taps and Beamy hops the lock open.',
    gesture: 'Tap Beamy',
    lines: {
      greeting: 'This one needs a little wake-up call.',
      hint: 'Tap me a few times to unlock it.',
      cheer: '{left} more!',
      unlocked: 'You did it!',
    },
  },
  turn: {
    id: 'turn',
    label: 'Turn the ring',
    blurb: 'Spin the ring round Beamy, like a vault dial.',
    gesture: 'Turn the ring',
    lines: {
      greeting: 'It is locked up tight.',
      hint: 'Spin the ring around me to unlock it.',
      cheer: 'Almost there, keep turning.',
      unlocked: 'Click. Unlocked!',
    },
  },
  trace: {
    id: 'trace',
    label: 'Trace Beamy',
    blurb: 'Draw round Beamy with a finger to light him up.',
    gesture: 'Trace Beamy',
    lines: {
      greeting: 'Draw me and I will open up.',
      hint: 'Trace my outline with your finger.',
      cheer: 'Nice lines, keep going.',
      unlocked: 'A masterpiece. Here you go!',
    },
  },
  rub: {
    id: 'rub',
    label: 'Rub to reveal',
    blurb: 'A scratch card: rub the frost off to see the news.',
    gesture: 'Rub the frost',
    lines: {
      greeting: 'There is a surprise under the frost.',
      hint: 'Rub it with your finger to scratch it off.',
      cheer: 'Keep rubbing, I can see something!',
      unlocked: 'Ooh, shiny. It is all yours.',
    },
  },
};

/** Taps the `tap` unlock asks for (editor slider range). */
export const TAPS_MIN = 3;
export const TAPS_MAX = 9;
export const TAPS_DEFAULT = 5;

/* ------------------------------------------------------------------ */
/* Themes: the colour of the night                                     */
/* ------------------------------------------------------------------ */

export const REVEAL_THEMES = ['periwinkle', 'midnight', 'sunrise', 'mint', 'gold', 'frost'] as const;
export type RevealTheme = typeof REVEAL_THEMES[number];

export interface ThemePalette {
  id: RevealTheme;
  label: string;
  /** Page backdrop: a top and bottom stop for a vertical wash (backdrop only, never buttons or text). */
  bgTop: string;
  bgBottom: string;
  /** The panel colour behind the email's content and the reveal card. */
  panel: string;
  /** Text on the panel. */
  fg: string;
  muted: string;
  /** Buttons, rings, the glow. */
  accent: string;
  /** Text on an accent button. */
  onAccent: string;
  /** A second, warm light (Beamy's core, sparks). */
  core: string;
}

export const THEME_PALETTES: Record<RevealTheme, ThemePalette> = {
  periwinkle: {
    id: 'periwinkle', label: 'Beamwall',
    bgTop: '#2A2A8C', bgBottom: '#0B0A2A', panel: '#17165A',
    fg: '#FFFFFF', muted: '#C9CBF5', accent: '#D4D6FF', onAccent: '#17165A', core: '#FFC46B',
  },
  midnight: {
    id: 'midnight', label: 'Midnight',
    bgTop: '#141B3D', bgBottom: '#03040C', panel: '#0E1330',
    fg: '#FFFFFF', muted: '#AEB7DA', accent: '#8EA2FF', onAccent: '#070A1E', core: '#E8ECFF',
  },
  sunrise: {
    id: 'sunrise', label: 'Sunrise',
    bgTop: '#5C2140', bgBottom: '#1C0A16', panel: '#3A1430',
    fg: '#FFFFFF', muted: '#F2C9D6', accent: '#FFB38A', onAccent: '#3A1430', core: '#FFE1A8',
  },
  mint: {
    id: 'mint', label: 'Mint',
    bgTop: '#0F4A42', bgBottom: '#03140F', panel: '#0A2E29',
    fg: '#FFFFFF', muted: '#BDE9DD', accent: '#7FF0C8', onAccent: '#06241F', core: '#F4FFB8',
  },
  gold: {
    id: 'gold', label: 'Gold',
    bgTop: '#4A3410', bgBottom: '#120C04', panel: '#2B1F0A',
    fg: '#FFFFFF', muted: '#EBD9B0', accent: '#FFD36B', onAccent: '#2B1F0A', core: '#FFF2C8',
  },
  frost: {
    id: 'frost', label: 'Frost',
    bgTop: '#1F4C78', bgBottom: '#06121F', panel: '#0F2A47',
    fg: '#FFFFFF', muted: '#C6E2F7', accent: '#BFE6FF', onAccent: '#0B2238', core: '#FFFFFF',
  },
};

/* ------------------------------------------------------------------ */
/* Occasions: the starting templates                                    */
/* ------------------------------------------------------------------ */

export const REVEAL_OCCASIONS = ['feature-drop', 'big-news', 'milestone', 'offer', 'invite', 'thank-you', 'holiday'] as const;
export type RevealOccasion = typeof REVEAL_OCCASIONS[number];

export interface RevealEmailCopy {
  subject: string;
  /** Inbox preview text (hidden in the body). */
  preheader: string;
  kicker: string;
  headline: string;
  body: string;
  /** The big glowing button. */
  ctaLabel: string;
  /** Small print under the button. */
  footnote: string;
}

export interface RevealTeaser {
  kicker: string;
  headline: string;
}

export interface RevealPayload {
  eyebrow: string;
  title: string;
  body: string;
  /** https image shown in the reveal card (optional: '' = none). */
  imageUrl: string;
  /** The reveal card's own button ('' = no button). */
  ctaLabel: string;
  /** https URL or a site path starting with '/' ('' = no button). */
  ctaUrl: string;
}

export interface RevealDoc {
  occasion: RevealOccasion;
  theme: RevealTheme;
  unlock: RevealUnlock;
  /** Taps the `tap` unlock asks for. */
  taps: number;
  email: RevealEmailCopy;
  teaser: RevealTeaser;
  beamy: BeamyLines;
  reveal: RevealPayload;
}

export interface OccasionMeta {
  id: RevealOccasion;
  label: string;
  blurb: string;
  theme: RevealTheme;
  unlock: RevealUnlock;
  email: RevealEmailCopy;
  teaser: RevealTeaser;
  reveal: RevealPayload;
}

const FOOT = 'Takes five seconds. Beamy is very excited about this one.';

export const OCCASION_META: Record<RevealOccasion, OccasionMeta> = {
  'feature-drop': {
    id: 'feature-drop',
    label: 'New feature dropped',
    blurb: 'Tease a launch, then let Beamy blast it open.',
    theme: 'periwinkle',
    unlock: 'blast',
    email: {
      subject: 'New feature dropped (and it is a good one)',
      preheader: 'Beamy is guarding it. One tap to find out what it is.',
      kicker: 'New feature dropped',
      headline: 'We made something you are going to love.',
      body: 'It is an exciting one. We could just tell you, but Beamy insisted on a proper reveal. Tap the button to find out what it is.',
      ctaLabel: 'Reveal now',
      footnote: FOOT,
    },
    teaser: { kicker: 'New feature dropped', headline: 'Something new is in here.' },
    reveal: {
      eyebrow: 'Just landed',
      title: 'Your new feature',
      body: 'Say what it does, who it is for and why it matters, in two short sentences.',
      imageUrl: '',
      ctaLabel: 'Try it now',
      ctaUrl: '/',
    },
  },
  'big-news': {
    id: 'big-news',
    label: 'Big news',
    blurb: 'An announcement worth a moment of suspense.',
    theme: 'midnight',
    unlock: 'shine',
    email: {
      subject: 'We have some big news',
      preheader: 'It is too big for a subject line. Come see.',
      kicker: 'Big news',
      headline: 'Something big just happened.',
      body: 'We have been keeping this one quiet. Beamy has the details, and he would love to show you himself.',
      ctaLabel: 'Reveal the news',
      footnote: FOOT,
    },
    teaser: { kicker: 'Big news', headline: 'Ready for it?' },
    reveal: {
      eyebrow: 'The big news',
      title: 'Here is what happened',
      body: 'Share the announcement here.',
      imageUrl: '',
      ctaLabel: 'Read more',
      ctaUrl: '/',
    },
  },
  milestone: {
    id: 'milestone',
    label: 'Milestone',
    blurb: 'Celebrate a number, an anniversary, a first.',
    theme: 'gold',
    unlock: 'tap',
    email: {
      subject: 'We hit a milestone, thanks to you',
      preheader: 'Beamy is throwing a tiny party. You are invited.',
      kicker: 'Milestone unlocked',
      headline: 'We just hit a big one.',
      body: 'None of it happens without you. Wake Beamy up and see what we are celebrating.',
      ctaLabel: 'Reveal it',
      footnote: FOOT,
    },
    teaser: { kicker: 'Milestone unlocked', headline: 'Let us celebrate.' },
    reveal: {
      eyebrow: 'Milestone',
      title: '10,000 photos beamed',
      body: 'Say what you reached and thank the people who got you there.',
      imageUrl: '',
      ctaLabel: 'See the moments',
      ctaUrl: '/',
    },
  },
  offer: {
    id: 'offer',
    label: 'Special offer',
    blurb: 'A scratch-card reveal for a deal or a gift.',
    theme: 'sunrise',
    unlock: 'rub',
    email: {
      subject: 'Something special, just for you',
      preheader: 'Scratch it off to see what Beamy saved you.',
      kicker: 'A little something',
      headline: 'We saved you something special.',
      body: 'Beamy hid it under the frost. Scratch it off and it is yours.',
      ctaLabel: 'Reveal my offer',
      footnote: FOOT,
    },
    teaser: { kicker: 'Just for you', headline: 'What did Beamy save you?' },
    reveal: {
      eyebrow: 'Your offer',
      title: '20% off your next event',
      body: 'Use it at checkout before the end of the month.',
      imageUrl: '',
      ctaLabel: 'Claim it',
      ctaUrl: '/',
    },
  },
  invite: {
    id: 'invite',
    label: 'You are invited',
    blurb: 'An invitation that unlocks like a vault.',
    theme: 'mint',
    unlock: 'turn',
    email: {
      subject: 'You are invited',
      preheader: 'Your invitation is locked in with Beamy. Turn the dial.',
      kicker: 'An invitation',
      headline: 'Your invitation is waiting.',
      body: 'Beamy is holding it for you. Turn the dial to unlock the details.',
      ctaLabel: 'Unlock my invite',
      footnote: FOOT,
    },
    teaser: { kicker: 'You are invited', headline: 'Unlock your invitation.' },
    reveal: {
      eyebrow: 'You are invited',
      title: 'Join us',
      body: 'Say what, when and where, and what to bring.',
      imageUrl: '',
      ctaLabel: 'Save my spot',
      ctaUrl: '/',
    },
  },
  'thank-you': {
    id: 'thank-you',
    label: 'Thank you',
    blurb: 'A warm thank-you the reader draws open.',
    theme: 'midnight',
    unlock: 'trace',
    email: {
      subject: 'A little thank-you from us',
      preheader: 'Beamy drew you something. Well, you draw it. Come see.',
      kicker: 'Thank you',
      headline: 'We made you a little something.',
      body: 'A small thank-you for being part of Beamwall. Trace Beamy to open it.',
      ctaLabel: 'Open it',
      footnote: FOOT,
    },
    teaser: { kicker: 'Thank you', headline: 'This one is for you.' },
    reveal: {
      eyebrow: 'From all of us',
      title: 'Thank you',
      body: 'Say thanks in your own words.',
      imageUrl: '',
      ctaLabel: '',
      ctaUrl: '',
    },
  },
  holiday: {
    id: 'holiday',
    label: 'Season\'s greetings',
    blurb: 'A frosty seasonal greeting Beamy melts open.',
    theme: 'frost',
    unlock: 'melt',
    email: {
      subject: 'Season\'s greetings from Beamy',
      preheader: 'He froze something for you. Help him thaw it.',
      kicker: 'Season\'s greetings',
      headline: 'A frosty little surprise.',
      body: 'Beamy wrapped your greeting in ice (he got carried away). Help him melt it.',
      ctaLabel: 'Melt it open',
      footnote: FOOT,
    },
    teaser: { kicker: 'Season\'s greetings', headline: 'It froze solid.' },
    reveal: {
      eyebrow: 'Season\'s greetings',
      title: 'Happy holidays',
      body: 'Wishing you and yours a bright, warm season.',
      imageUrl: '',
      ctaLabel: '',
      ctaUrl: '',
    },
  },
};

/** A complete document for an occasion, with its default theme, unlock and Beamy's lines. */
export function presetDoc(occasion: RevealOccasion): RevealDoc {
  const o = OCCASION_META[occasion];
  return {
    occasion,
    theme: o.theme,
    unlock: o.unlock,
    taps: TAPS_DEFAULT,
    email: { ...o.email },
    teaser: { ...o.teaser },
    beamy: { ...UNLOCK_META[o.unlock].lines },
    reveal: { ...o.reveal },
  };
}

/**
 * Switching the unlock in the editor: Beamy's lines follow the new unlock
 * unless the admin wrote their own (a line still equal to the OLD unlock's
 * default is replaced; an edited one is kept).
 */
export function withUnlock(doc: RevealDoc, unlock: RevealUnlock): RevealDoc {
  const before = UNLOCK_META[doc.unlock].lines;
  const after = UNLOCK_META[unlock].lines;
  const keys = Object.keys(after) as (keyof BeamyLines)[];
  const beamy = { ...doc.beamy };
  for (const k of keys) if (beamy[k] === before[k]) beamy[k] = after[k];
  return { ...doc, unlock, beamy };
}

/* ------------------------------------------------------------------ */
/* Limits + normalisation                                              */
/* ------------------------------------------------------------------ */

/** Character caps the editor shows and normalisation enforces. */
export const CAPS = {
  subject: 90,
  preheader: 140,
  kicker: 40,
  headline: 90,
  body: 420,
  ctaLabel: 28,
  footnote: 140,
  line: 90,
  eyebrow: 40,
  title: 80,
  revealBody: 600,
  url: 500,
} as const;

function obj(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

/** Collapse whitespace control chars, trim, clip. Keeps line breaks in long text. */
export function cleanText(v: unknown, max: number, fallback: string, multiline = false): string {
  if (typeof v !== 'string') return fallback;
  let s = v.replace(/\r\n?/g, '\n');
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  s = multiline ? s.replace(/\n{3,}/g, '\n\n') : s.replace(/\s*\n\s*/g, ' ');
  s = s.trim();
  if (s.length > max) s = s.slice(0, max).trimEnd();
  return s;
}

/** An https URL, or a site path starting with a single '/'. Anything else → ''. */
export function safeLink(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (s === '' || s.length > CAPS.url) return '';
  if (s.startsWith('/') && !s.startsWith('//')) return /^[\w\-./?=&%#~+:]*$/.test(s) ? s : '';
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && u.username === '' && u.password === '' ? u.toString() : '';
  } catch {
    return '';
  }
}

/** Images must be https (an email and a public page both show them). */
export function safeImage(v: unknown): string {
  const s = safeLink(v);
  return s.startsWith('https://') ? s : '';
}

function pick<T extends string>(list: readonly T[], v: unknown, fallback: T): T {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T : fallback;
}

/**
 * TOTAL. Unknown occasion → feature-drop; each field falls back to the
 * occasion's preset when missing, but an explicit '' is kept for the
 * optional fields (image, the reveal button) so "no button" survives a save.
 */
export function normalizeRevealDoc(raw: unknown): RevealDoc {
  const r = obj(raw);
  const occasion = pick(REVEAL_OCCASIONS, r.occasion, 'feature-drop');
  const base = presetDoc(occasion);
  const theme = pick(REVEAL_THEMES, r.theme, base.theme);
  const unlock = pick(REVEAL_UNLOCKS, r.unlock, base.unlock);
  const lines = UNLOCK_META[unlock].lines;
  const tapsRaw = typeof r.taps === 'number' && Number.isFinite(r.taps) ? Math.round(r.taps) : TAPS_DEFAULT;
  const e = obj(r.email);
  const t = obj(r.teaser);
  const b = obj(r.beamy);
  const v = obj(r.reveal);
  const req = (x: unknown, max: number, fb: string, multi = false) => cleanText(x, max, fb, multi) || fb;
  const opt = (x: unknown, max: number, fb: string) => (x === undefined ? fb : cleanText(x, max, ''));
  return {
    occasion,
    theme,
    unlock,
    taps: Math.min(TAPS_MAX, Math.max(TAPS_MIN, tapsRaw)),
    email: {
      subject: req(e.subject, CAPS.subject, base.email.subject),
      preheader: opt(e.preheader, CAPS.preheader, base.email.preheader),
      kicker: opt(e.kicker, CAPS.kicker, base.email.kicker),
      headline: req(e.headline, CAPS.headline, base.email.headline),
      body: opt(e.body, CAPS.body, base.email.body),
      ctaLabel: req(e.ctaLabel, CAPS.ctaLabel, base.email.ctaLabel),
      footnote: opt(e.footnote, CAPS.footnote, base.email.footnote),
    },
    teaser: {
      kicker: opt(t.kicker, CAPS.kicker, base.teaser.kicker),
      headline: req(t.headline, CAPS.headline, base.teaser.headline),
    },
    beamy: {
      greeting: req(b.greeting, CAPS.line, lines.greeting),
      hint: req(b.hint, CAPS.line, lines.hint),
      cheer: req(b.cheer, CAPS.line, lines.cheer),
      unlocked: req(b.unlocked, CAPS.line, lines.unlocked),
    },
    reveal: {
      eyebrow: opt(v.eyebrow, CAPS.eyebrow, base.reveal.eyebrow),
      title: req(v.title, CAPS.title, base.reveal.title),
      body: cleanText(v.body, CAPS.revealBody, v.body === undefined ? base.reveal.body : '', true),
      imageUrl: v.imageUrl === undefined ? base.reveal.imageUrl : safeImage(v.imageUrl),
      ctaLabel: opt(v.ctaLabel, CAPS.ctaLabel, base.reveal.ctaLabel),
      ctaUrl: v.ctaUrl === undefined ? base.reveal.ctaUrl : safeLink(v.ctaUrl),
    },
  };
}

/** The reveal card shows its button only with both a label and a link. */
export function hasRevealCta(doc: RevealDoc): boolean {
  return doc.reveal.ctaLabel !== '' && doc.reveal.ctaUrl !== '';
}

/** `{left}` in the cheer line → the count still to go. */
export function fillLine(line: string, left: number): string {
  return line.replace(/\{left\}/g, String(Math.max(0, Math.round(left))));
}

/* ------------------------------------------------------------------ */
/* Slugs + URLs                                                        */
/* ------------------------------------------------------------------ */

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/;

/** "New feature: Live captions!" → "new-feature-live-captions" (≤60, may be '' for junk). */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

export function isValidSlug(s: string): boolean {
  return SLUG_RE.test(s);
}

/** A unique slug from a name: `base`, then `base-2`, `base-3`… against the slugs given. */
export function uniqueSlug(name: string, taken: readonly string[]): string {
  const base = (slugify(name) || 'reveal').slice(0, 52).replace(/-+$/, '') || 'reveal';
  const fixed = base.length < 2 ? `${base}-reveal` : base;
  const set = new Set(taken);
  if (!set.has(fixed)) return fixed;
  for (let n = 2; n < 1000; n++) if (!set.has(`${fixed}-${n}`)) return `${fixed}-${n}`;
  return `${fixed}-${Date.now().toString(36)}`;
}

/** Public reveal page for a slug. `origin` without a trailing slash. */
export function revealUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/+$/, '')}/reveal/${encodeURIComponent(slug)}`;
}

/** The demo route that renders an occasion's preset with no database. */
export function demoRevealPath(occasion: RevealOccasion): string {
  return `/reveal/demo/${occasion}`;
}

/* ------------------------------------------------------------------ */
/* Editor ↔ preview iframe contract                                    */
/* ------------------------------------------------------------------ */

/** The preview page (/reveal/preview) posts this to its parent once it listens. */
export const REVEAL_PREVIEW_READY = 'beamwall:reveal-preview-ready';

export type RevealPreviewMessage =
  | { type: 'beamwall:reveal-preview-doc'; doc: RevealDoc }
  /** Start the experience over (sealed again). */
  | { type: 'beamwall:reveal-preview-replay' }
  /** Jump straight to the unlocked state (editing the reveal card). */
  | { type: 'beamwall:reveal-preview-open' };

/** TOTAL reader for the preview page: anything else → null. */
export function readPreviewMessage(data: unknown): RevealPreviewMessage | null {
  const d = obj(data);
  if (d.type === 'beamwall:reveal-preview-doc') return { type: d.type, doc: normalizeRevealDoc(d.doc) };
  if (d.type === 'beamwall:reveal-preview-replay' || d.type === 'beamwall:reveal-preview-open') return { type: d.type };
  return null;
}
