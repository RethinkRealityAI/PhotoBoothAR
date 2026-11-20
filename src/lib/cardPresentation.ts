/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cardPresentation — HOW a keepsake card arrives, as a host choice.
 *
 * Three independent axes, each a closed set:
 *   • reveal — the opening moment on /c/:publicId before the card itself
 *              (an envelope that unfolds, a curtain that pulls away to a
 *              floating 3D card, a paper airplane, stardust…), or none.
 *   • email  — the style of the delivery email card-publish sends.
 *   • look   — whose colours the card wears: the Beamwall brand look, the
 *              event's own snapshot (lib/cardTheme.ts), or 'auto'.
 * The card STYLE (storybook, film strip…) stays where it always lived, in
 * `cards.template` / lib/cardTemplates.ts.
 *
 * Stored in `cards.presentation` jsonb (migration 049). The edge functions
 * that read it (card-view, card-publish) normalise it themselves, so this
 * module is the browser half and the source of the closed sets.
 *
 * Everything here is PURE (no React, no DOM, no supabase) so it unit-tests in
 * vitest's node env.
 *
 * TOTALITY: `normalizeCardPresentation` never throws and always returns a
 * presentation this build can render — a hand-edited row, a newer build's id
 * or junk all fall back to the defaults, because a published keepsake must
 * always open.
 */

/* ------------------------------------------------------------------ */
/* Closed sets                                                         */
/* ------------------------------------------------------------------ */

export type CardRevealId = 'none' | 'envelope' | 'ribbon' | 'curtain' | 'airplane' | 'stardust' | 'papercut';
export const CARD_REVEAL_IDS = ['envelope', 'ribbon', 'curtain', 'airplane', 'stardust', 'papercut', 'none'] as const;

export type CardEmailStyleId = 'glow' | 'sealed' | 'spotlight';
export const CARD_EMAIL_STYLE_IDS = ['glow', 'sealed', 'spotlight'] as const;

export type CardLookId = 'auto' | 'beamwall' | 'event';
export const CARD_LOOK_IDS = ['auto', 'beamwall', 'event'] as const;

/**
 * 'standard' options work on any phone; 'premium' ones are the 3D/WebGL
 * showpieces. Every option is selectable today (the owner is assessing them);
 * the tier exists so a later plan gate has one place to read from.
 */
export type CardPresentationTier = 'standard' | 'premium';

export interface CardRevealOption {
  id: CardRevealId;
  label: string;
  /** One line a host can decide from. */
  description: string;
  tier: CardPresentationTier;
  /** True when the reveal needs WebGL; without it the viewer falls back to
   *  REVEAL_WEBGL_FALLBACK so the moment still happens. */
  needsWebGL: boolean;
  /** Occasions it suits, shown to hosts as a hint (never a restriction). */
  goodFor: string;
}

export const CARD_REVEAL_OPTIONS: readonly CardRevealOption[] = [
  {
    id: 'envelope',
    label: 'Envelope',
    description: 'An embossed envelope with a wax seal. Tap the seal, light pours from the seams and the card rises out.',
    tier: 'standard',
    needsWebGL: false,
    goodFor: 'Any occasion',
  },
  {
    id: 'ribbon',
    label: 'Satin ribbon',
    description: 'A satin bow tied around the card. Pull it and the ribbon slips away to reveal what is inside.',
    tier: 'standard',
    needsWebGL: false,
    goodFor: 'Weddings, anniversaries',
  },
  {
    id: 'curtain',
    label: 'Grand reveal',
    description: 'The screen parts like stage doors and the card floats in 3D, turning gently in the light.',
    tier: 'premium',
    needsWebGL: true,
    goodFor: 'Milestones, big celebrations',
  },
  {
    id: 'airplane',
    label: 'Paper airplane',
    description: 'A paper airplane glides in, loops once and unfolds into the card in their hands.',
    tier: 'premium',
    needsWebGL: true,
    goodFor: 'Birthdays, farewells, friends far away',
  },
  {
    id: 'stardust',
    label: 'Stardust',
    description: 'A swirl of glowing particles gathers and condenses into the card.',
    tier: 'premium',
    needsWebGL: true,
    goodFor: 'Any occasion',
  },
  {
    id: 'papercut',
    label: 'Pop-up paper',
    description: 'Layers of cut paper spring up in depth and drift as the phone tilts, then part to show the card.',
    tier: 'standard',
    needsWebGL: false,
    goodFor: 'Birthdays, kids, playful parties',
  },
  {
    id: 'none',
    label: 'Straight to the card',
    description: 'No opening moment. The card is on screen the second the link opens.',
    tier: 'standard',
    needsWebGL: false,
    goodFor: 'Quick notes',
  },
];

export interface CardEmailStyleOption {
  id: CardEmailStyleId;
  label: string;
  description: string;
  tier: CardPresentationTier;
}

export const CARD_EMAIL_STYLE_OPTIONS: readonly CardEmailStyleOption[] = [
  {
    id: 'glow',
    label: 'Glow',
    description: 'A calm, roomy note: the title, a glimpse of the photos and one button.',
    tier: 'standard',
  },
  {
    id: 'sealed',
    label: 'Sealed',
    description: 'A closed envelope with a glowing seal. Nothing is shown until they open it.',
    tier: 'standard',
  },
  {
    id: 'spotlight',
    label: 'Spotlight',
    description: 'One big photo from the card, full width, with the title over it.',
    tier: 'standard',
  },
];

export interface CardLookOption {
  id: CardLookId;
  label: string;
  description: string;
}

export const CARD_LOOK_OPTIONS: readonly CardLookOption[] = [
  {
    id: 'auto',
    label: 'Automatic',
    description: "The event's colours when you set custom branding, otherwise the Beamwall look.",
  },
  {
    id: 'beamwall',
    label: 'Beamwall',
    description: 'The soft dusk-blue Beamwall look, whatever the event uses.',
  },
  {
    id: 'event',
    label: 'Event colours',
    description: "The colours and fonts guests saw at the event.",
  },
];

/* ------------------------------------------------------------------ */
/* Shape + defaults                                                    */
/* ------------------------------------------------------------------ */

export const CARD_PRESENTATION_VERSION = 1;

export interface CardPresentation {
  v: number;
  reveal: CardRevealId;
  email: CardEmailStyleId;
  look: CardLookId;
}

/**
 * What a card with no stored choice gets. The envelope is the default opening
 * because it is the magic moment that works on every phone (no WebGL).
 */
export const DEFAULT_CARD_PRESENTATION: Readonly<CardPresentation> = Object.freeze({
  v: CARD_PRESENTATION_VERSION,
  reveal: 'envelope',
  email: 'glow',
  look: 'auto',
});

/** Where a WebGL reveal lands on a device without WebGL. */
export const REVEAL_WEBGL_FALLBACK: CardRevealId = 'envelope';

export function isCardRevealId(raw: unknown): raw is CardRevealId {
  return typeof raw === 'string' && (CARD_REVEAL_IDS as readonly string[]).includes(raw);
}
export function isCardEmailStyleId(raw: unknown): raw is CardEmailStyleId {
  return typeof raw === 'string' && (CARD_EMAIL_STYLE_IDS as readonly string[]).includes(raw);
}
export function isCardLookId(raw: unknown): raw is CardLookId {
  return typeof raw === 'string' && (CARD_LOOK_IDS as readonly string[]).includes(raw);
}

/** TOTAL parser for whatever sits in `cards.presentation`. */
export function normalizeCardPresentation(raw: unknown): CardPresentation {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    v: CARD_PRESENTATION_VERSION,
    reveal: isCardRevealId(obj.reveal) ? obj.reveal : DEFAULT_CARD_PRESENTATION.reveal,
    email: isCardEmailStyleId(obj.email) ? obj.email : DEFAULT_CARD_PRESENTATION.email,
    look: isCardLookId(obj.look) ? obj.look : DEFAULT_CARD_PRESENTATION.look,
  };
}

export function revealOption(id: CardRevealId): CardRevealOption {
  return CARD_REVEAL_OPTIONS.find((o) => o.id === id) ?? CARD_REVEAL_OPTIONS[0];
}

/**
 * The reveal this device will actually play: a WebGL reveal on a device
 * without WebGL plays the fallback instead of nothing.
 */
export function playableReveal(id: CardRevealId, webgl: boolean): CardRevealId {
  return revealOption(id).needsWebGL && !webgl ? REVEAL_WEBGL_FALLBACK : id;
}

/**
 * The wax-seal monogram: the recipient's initials (max 2), else the title's
 * first letter, else a star. "Dapo" → "D", "Maya & Sam" → "MS",
 * "dapo ajisafe" → "DA". Letters only (any script); never empty.
 */
export function cardMonogram(recipientName: string | null | undefined, title?: string | null): string {
  const words = (s: string | null | undefined) =>
    (s ?? '')
      .split(/[^\p{L}]+/u)
      .filter((w) => w.length > 0);
  const fromName = words(recipientName)
    .slice(0, 2)
    .map((w) => w[0].toLocaleUpperCase())
    .join('');
  if (fromName !== '') return fromName;
  const first = words(title)[0];
  return first ? first[0].toLocaleUpperCase() : '✦';
}

/* ------------------------------------------------------------------ */
/* URL overrides — assess every option without saving anything         */
/* ------------------------------------------------------------------ */

export interface CardViewOverrides {
  reveal?: CardRevealId;
  look?: CardLookId;
  /** A raw template id; the viewer resolves it through the template
   *  registry, which already falls back on an unknown id. */
  template?: string;
}

const TEMPLATE_PARAM_RE = /^[a-z0-9-]{1,32}$/;

/**
 * `?reveal=airplane&template=storybook&look=beamwall` on /c/:publicId.
 * Purely cosmetic and per-visit: it changes nothing stored, grants nothing,
 * and an unknown value is ignored (never an error page).
 */
export function parseCardViewOverrides(search: string): CardViewOverrides {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return {};
  }
  const out: CardViewOverrides = {};
  const reveal = params.get('reveal');
  if (isCardRevealId(reveal)) out.reveal = reveal;
  const look = params.get('look');
  if (isCardLookId(look)) out.look = look;
  const template = params.get('template');
  if (template !== null && TEMPLATE_PARAM_RE.test(template)) out.template = template;
  return out;
}

/* ------------------------------------------------------------------ */
/* Look resolution                                                     */
/* ------------------------------------------------------------------ */

/**
 * Accents that mean "the host never picked colours": the Beamwall brand
 * highlight every new event starts with (eventTemplates.ts
 * BEAMWALL_LOOK_VARS / platform.css --pf-accent). A snapshot carrying one of
 * these is the platform default, not a design choice worth preserving.
 */
const PLATFORM_DEFAULT_ACCENTS: ReadonlySet<string> = new Set(['#d4d6ff']);

/**
 * 'auto' → the event's own colours only when its snapshot carries a custom
 * accent; otherwise the Beamwall look. Explicit choices are honoured as-is,
 * except 'event' with nothing to paint, which can only render as Beamwall.
 *
 * @param themeVars the snapshot's `vars` (lib/cardTheme.ts normalizeCardTheme)
 */
export function resolveCardLook(
  look: CardLookId,
  themeVars: Readonly<Record<string, string>> | null | undefined,
): 'beamwall' | 'event' {
  const vars = themeVars ?? {};
  const hasVars = Object.keys(vars).length > 0;
  if (look === 'beamwall' || !hasVars) return 'beamwall';
  if (look === 'event') return 'event';
  const accent = (vars['--color-accent'] ?? '').trim().toLowerCase();
  if (accent === '' || PLATFORM_DEFAULT_ACCENTS.has(accent)) return 'beamwall';
  return 'event';
}

/**
 * Literal colours for the canvases and shaders that cannot read CSS tokens
 * cheaply (reveals, 3D templates). Beamwall = the brand v2 dusk values
 * (platform.css --pf-bg / --pf-accent); event = the snapshot, each key
 * falling back to Beamwall when the snapshot lacks it.
 */
export interface CardPalette {
  bg: string;
  fg: string;
  accent: string;
  /** "r, g, b" */
  accentRgb: string;
}

export const BEAMWALL_CARD_PALETTE: Readonly<CardPalette> = Object.freeze({
  bg: '#33318A',
  fg: '#FFFFFF',
  accent: '#D4D6FF',
  accentRgb: '212, 214, 255',
});

const HEX_RE = /^#[0-9a-f]{6}$/i;
const RGB_TRIPLET_RE = /^\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*$/;

function hexToTriplet(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

export function cardPalette(
  look: 'beamwall' | 'event',
  themeVars: Readonly<Record<string, string>> | null | undefined,
): CardPalette {
  if (look === 'beamwall' || !themeVars) return { ...BEAMWALL_CARD_PALETTE };
  const pick = (key: string, fallback: string) => {
    const v = (themeVars[key] ?? '').trim();
    return HEX_RE.test(v) ? v : fallback;
  };
  const accent = pick('--color-accent', BEAMWALL_CARD_PALETTE.accent);
  const rgbVar = (themeVars['--accent-rgb'] ?? '').trim();
  return {
    bg: pick('--color-brand-bg', BEAMWALL_CARD_PALETTE.bg),
    fg: pick('--color-brand-fg', BEAMWALL_CARD_PALETTE.fg),
    accent,
    accentRgb: RGB_TRIPLET_RE.test(rgbVar) ? rgbVar.replace(/\s+/g, ' ').replace(/ ,/g, ',') : hexToTriplet(accent),
  };
}
