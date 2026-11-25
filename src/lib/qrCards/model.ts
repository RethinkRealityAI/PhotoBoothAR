/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * qrCards/model — the printable QR card generator's data: the template
 * library, the print sizes, the guest links a code can point at, and the
 * saved design (`events.config.qrCard`).
 *
 * A template is a whole look: one of four layouts, a scene from the keepsake
 * card / email design library (or a reveal-email glow), a palette, a font
 * set and starting words. The host changes words, accent, link, size and
 * orientation; the template keeps everything else, so every card that leaves
 * the generator stays designed.
 *
 * PURE: no React, no DOM, no supabase.
 */

/* ------------------------------------------------------------------ */
/* Occasions, layouts, sizes                                           */
/* ------------------------------------------------------------------ */

export const QR_OCCASIONS = [
  'wedding',
  'birthday',
  'anniversary',
  'retirement',
  'corporate',
  'launch',
  'christmas',
  'halloween',
  'graduation',
  'baby',
  'culture',
] as const;
export type QrOccasion = typeof QR_OCCASIONS[number];

export const OCCASION_LABEL: Record<QrOccasion, string> = {
  wedding: 'Wedding',
  birthday: 'Birthday',
  anniversary: 'Anniversary',
  retirement: 'Retirement',
  corporate: 'Corporate',
  launch: 'Product launch',
  christmas: 'Christmas',
  halloween: 'Halloween',
  graduation: 'Graduation',
  baby: 'Baby shower',
  culture: 'Festivals',
};

/**
 * glass   the scene full-bleed under a frosted panel (landscape: crisp scene
 *         left, frosted scene right)
 * window  a paper field with an arched window onto the scene; the code sits
 *         on the window's sill
 * ticket  an admit-one ticket over the scene, the code on the torn-off stub
 * glow    the reveal-email look: a dusk gradient, stars, a glowing code and
 *         Beamy beside it
 */
export type QrLayout = 'glass' | 'window' | 'ticket' | 'glow';
export type QrOrientation = 'portrait' | 'landscape';

export const QR_SIZES = [
  { id: '5x7', label: '5 × 7 in', note: 'Table sign', wIn: 5, hIn: 7 },
  { id: '4x6', label: '4 × 6 in', note: 'Place card', wIn: 4, hIn: 6 },
  { id: 'a5', label: 'A5', note: '148 × 210 mm', wIn: 5.827, hIn: 8.268 },
] as const;
export type QrSizeId = typeof QR_SIZES[number]['id'];

/** Print resolution for PNG and the PDF's picture. */
export const PRINT_DPI = 300;
/** Layout units per inch: a 5x7 portrait card is 500 x 700 units. */
export const UNITS_PER_IN = 100;

export function cardSize(size: QrSizeId, orientation: QrOrientation): { wIn: number; hIn: number; w: number; h: number } {
  const s = QR_SIZES.find((x) => x.id === size) ?? QR_SIZES[0];
  const [wIn, hIn] = orientation === 'portrait' ? [s.wIn, s.hIn] : [s.hIn, s.wIn];
  return { wIn, hIn, w: wIn * UNITS_PER_IN, h: hIn * UNITS_PER_IN };
}

/* ------------------------------------------------------------------ */
/* Fonts and palettes                                                  */
/* ------------------------------------------------------------------ */

export interface QrFont {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  /** Set in capitals with this much letter spacing (em). */
  caps?: number;
}

const SERIF = 'Cormorant Garamond';
const DISPLAY = 'Bricolage Grotesque Variable';
const TEXT = 'Geist Variable';
const GEO = 'Jost';

export type QrFontSetId = 'classic' | 'party' | 'modern' | 'gala';
export interface QrFontSet { display: QrFont; accent: QrFont; label: QrFont; body: QrFont }

export const FONT_SETS: Record<QrFontSetId, QrFontSet> = {
  /** Weddings, anniversaries: a fine serif with an italic accent. */
  classic: {
    display: { family: SERIF, weight: 600, style: 'normal' },
    accent: { family: SERIF, weight: 500, style: 'italic' },
    label: { family: GEO, weight: 500, style: 'normal', caps: 0.22 },
    body: { family: GEO, weight: 400, style: 'normal' },
  },
  /** Parties: the brand's rounded display face. */
  party: {
    display: { family: DISPLAY, weight: 800, style: 'normal' },
    accent: { family: SERIF, weight: 600, style: 'italic' },
    label: { family: DISPLAY, weight: 600, style: 'normal', caps: 0.16 },
    body: { family: TEXT, weight: 500, style: 'normal' },
  },
  /** Corporate and launches: clean and confident. */
  modern: {
    display: { family: DISPLAY, weight: 700, style: 'normal' },
    accent: { family: GEO, weight: 500, style: 'normal', caps: 0.28 },
    label: { family: GEO, weight: 500, style: 'normal', caps: 0.24 },
    body: { family: TEXT, weight: 400, style: 'normal' },
  },
  /** Formal nights: tall serif capitals. */
  gala: {
    display: { family: SERIF, weight: 600, style: 'normal', caps: 0.08 },
    accent: { family: SERIF, weight: 500, style: 'italic' },
    label: { family: GEO, weight: 400, style: 'normal', caps: 0.3 },
    body: { family: GEO, weight: 400, style: 'normal' },
  },
};

export interface QrPalette {
  /** The paper (window, ticket) or the gradient top (glow). */
  field: string;
  /** The gradient bottom (glow); the paper's shade elsewhere. */
  fieldTo: string;
  /** Headline and names. */
  ink: string;
  /** Message and small print. */
  muted: string;
  /** Kicker, rules, sparkles, the code's glow. */
  accent: string;
  /** The frosted panel's tint (glass), rgba. */
  glass: string;
  /** The code's dark modules. Always dark: scanners need dark on light. */
  qrInk: string;
  /** The code's tile. */
  qrTile: string;
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

export interface QrTemplateCopy {
  kicker: string;
  headline: string;
  footer: string;
}

export interface QrTemplate {
  id: string;
  name: string;
  occasion: QrOccasion;
  layout: QrLayout;
  /** Portrait scene art, or null for the glow layout. */
  art: string | null;
  /** Where the scene's subject sits vertically (0 top … 1 bottom), for crops. */
  artFocus: number;
  palette: QrPalette;
  fonts: QrFontSetId;
  /** Beamy stands beside the code (glow layout). */
  beamy?: boolean;
  /** Light ornaments drawn in the accent colour. */
  ornament: 'sparkles' | 'rules' | 'stars' | 'none';
  copy: QrTemplateCopy;
}

const designArt = (id: string) => `/email/designs/v2/${id}/field.jpg`;
const ownArt = (id: string) => `/qr-cards/art/${id}.webp`;

/** Light paper look: dark ink on cream. */
function paper(field: string, fieldTo: string, ink: string, muted: string, accent: string): QrPalette {
  return { field, fieldTo, ink, muted, accent, glass: 'rgba(255,255,255,0.72)', qrInk: '#14121C', qrTile: '#FFFFFF' };
}
/** Night look: light ink on a dark frosted panel. */
function night(field: string, fieldTo: string, accent: string, glass: string, muted = 'rgba(255,255,255,0.78)'): QrPalette {
  return { field, fieldTo, ink: '#FFFFFF', muted, accent, glass, qrInk: '#12111A', qrTile: '#FFFFFF' };
}

export const QR_TEMPLATES: readonly QrTemplate[] = [
  // Weddings
  {
    id: 'garden-vows', name: 'Garden vows', occasion: 'wedding', layout: 'window', art: designArt('garden-gate'), artFocus: 0.62,
    palette: paper('#F7F2E9', '#EDE4D3', '#3D4A3A', '#66705F', '#8C9B79'), fonts: 'classic', ornament: 'rules',
    copy: { kicker: 'Scan me', headline: 'Share the love', footer: '' },
  },
  {
    id: 'moonlit-arch', name: 'Moonlit arch', occasion: 'wedding', layout: 'glass', art: designArt('moon-gate'), artFocus: 0.35,
    palette: night('#1B1640', '#0B0A22', '#F4C9A8', 'rgba(22,18,58,0.58)'), fonts: 'classic', ornament: 'sparkles',
    copy: { kicker: 'Capture the night', headline: 'Strike a pose', footer: '' },
  },
  {
    id: 'grand-ballroom', name: 'Grand ballroom', occasion: 'wedding', layout: 'ticket', art: designArt('gala-night'), artFocus: 0.4,
    palette: paper('#FBF6EA', '#F1E6CC', '#1E2340', '#545A78', '#B8913F'), fonts: 'gala', ornament: 'rules',
    copy: { kicker: 'Admit all', headline: 'Photo booth', footer: '' },
  },
  // Birthdays
  {
    id: 'balloon-bash', name: 'Balloon bash', occasion: 'birthday', layout: 'glass', art: designArt('balloon-bash'), artFocus: 0.7,
    palette: { ...paper('#FFF4EA', '#FFE4D2', '#3B1E45', '#6A4A6E', '#F06A4A'), glass: 'rgba(255,250,246,0.74)' }, fonts: 'party', ornament: 'sparkles',
    copy: { kicker: 'Party time', headline: 'Snap, pose, share!', footer: '' },
  },
  {
    id: 'party-pop', name: 'Party pop', occasion: 'birthday', layout: 'ticket', art: designArt('pop-party'), artFocus: 0.7,
    palette: paper('#FFF8F3', '#FFE6EE', '#43204F', '#7A5A80', '#E0478A'), fonts: 'party', ornament: 'sparkles',
    copy: { kicker: 'You are invited to', headline: 'Pop into the booth', footer: '' },
  },
  {
    id: 'jungle-jam', name: 'Jungle jam', occasion: 'birthday', layout: 'window', art: designArt('jungle-party'), artFocus: 0.55,
    palette: paper('#F3F7E8', '#E4EDCF', '#1F3B2A', '#4D6650', '#E8812E'), fonts: 'party', ornament: 'sparkles',
    copy: { kicker: 'Roar!', headline: 'Wild photo booth', footer: '' },
  },
  // Anniversaries
  {
    id: 'golden-hour', name: 'Golden hour', occasion: 'anniversary', layout: 'window', art: designArt('golden-hour'), artFocus: 0.55,
    palette: paper('#FBF4E6', '#F2E3C4', '#4A2F17', '#7A5F44', '#C58A2E'), fonts: 'classic', ornament: 'rules',
    copy: { kicker: 'Years of us', headline: 'Celebrate with us', footer: '' },
  },
  {
    id: 'love-notes', name: 'Love notes', occasion: 'anniversary', layout: 'glass', art: designArt('love-notes'), artFocus: 0.55,
    palette: night('#2B1A4A', '#140C26', '#FFB8C9', 'rgba(40,20,64,0.56)'), fonts: 'classic', ornament: 'sparkles',
    copy: { kicker: 'Still us', headline: 'Snap a memory', footer: '' },
  },
  // Retirement
  {
    id: 'island-sunset', name: 'Island sunset', occasion: 'retirement', layout: 'glass', art: designArt('island-sunset'), artFocus: 0.5,
    palette: { ...paper('#FFF3EA', '#FFE0CF', '#3A2140', '#6B4E68', '#E86A4A'), glass: 'rgba(255,246,240,0.7)' }, fonts: 'classic', ornament: 'rules',
    copy: { kicker: 'The next chapter', headline: 'Cheers to you', footer: '' },
  },
  {
    id: 'cloud-nine', name: 'Cloud nine', occasion: 'retirement', layout: 'window', art: designArt('cloud-nine'), artFocus: 0.45,
    palette: paper('#FFF6F1', '#FBE6E0', '#4A2C4E', '#79617C', '#E68A7E'), fonts: 'classic', ornament: 'sparkles',
    copy: { kicker: 'Up, up and away', headline: 'Happy retirement', footer: '' },
  },
  // Corporate
  {
    id: 'city-lights', name: 'City lights', occasion: 'corporate', layout: 'glass', art: designArt('city-lights'), artFocus: 0.55,
    palette: night('#151A3C', '#080A1C', '#FFD27A', 'rgba(14,18,46,0.6)'), fonts: 'modern', ornament: 'rules',
    copy: { kicker: 'Live photo wall', headline: 'Get on the big screen', footer: '' },
  },
  {
    id: 'beam-brand', name: 'Beam', occasion: 'corporate', layout: 'glow', art: null, artFocus: 0.5,
    palette: night('#2A2A8C', '#0B0A2A', '#D4D6FF', 'rgba(23,22,90,0.6)', '#C9CBF5'), fonts: 'modern', beamy: true, ornament: 'stars',
    copy: { kicker: 'Scan to join', headline: 'Beam your photo to the wall', footer: '' },
  },
  // Product launches
  {
    id: 'showtime', name: 'Showtime', occasion: 'launch', layout: 'ticket', art: designArt('showtime'), artFocus: 0.5,
    palette: paper('#FFF7EC', '#F6E2C6', '#3E0F1C', '#73414B', '#C2333F'), fonts: 'gala', ornament: 'stars',
    copy: { kicker: 'Front row', headline: 'The big reveal', footer: '' },
  },
  {
    id: 'gold-reveal', name: 'Gold reveal', occasion: 'launch', layout: 'glow', art: null, artFocus: 0.5,
    palette: night('#4A3410', '#120C04', '#FFD36B', 'rgba(43,31,10,0.6)', '#EBD9B0'), fonts: 'modern', beamy: true, ornament: 'stars',
    copy: { kicker: 'Be first', headline: 'See it before anyone', footer: '' },
  },
  // Christmas
  {
    id: 'winter-glow', name: 'Winter glow', occasion: 'christmas', layout: 'window', art: designArt('winter-glow'), artFocus: 0.6,
    palette: paper('#F6F7F2', '#E6ECE6', '#173A34', '#4C635D', '#B8323A'), fonts: 'classic', ornament: 'stars',
    copy: { kicker: 'Merry & bright', headline: 'Jingle all the way', footer: '' },
  },
  {
    id: 'silent-night', name: 'Silent night', occasion: 'christmas', layout: 'glass', art: designArt('winter-glow'), artFocus: 0.3,
    palette: night('#13233F', '#060D1C', '#F2D48A', 'rgba(12,26,50,0.58)'), fonts: 'gala', ornament: 'stars',
    copy: { kicker: 'Season’s greetings', headline: 'Smile, it’s Christmas', footer: '' },
  },
  // Halloween
  {
    id: 'pumpkin-moon', name: 'Pumpkin moon', occasion: 'halloween', layout: 'glass', art: ownArt('pumpkin-moon'), artFocus: 0.35,
    palette: night('#2A0F3A', '#12061A', '#FFA94D', 'rgba(36,12,52,0.6)'), fonts: 'party', ornament: 'stars',
    copy: { kicker: 'If you dare', headline: 'Spooky snaps', footer: '' },
  },
  {
    id: 'spellbound', name: 'Spellbound', occasion: 'halloween', layout: 'ticket', art: ownArt('pumpkin-moon'), artFocus: 0.6,
    palette: { ...paper('#F7EEDD', '#EADBC0', '#2A0F3A', '#5D4466', '#D9662A'), qrTile: '#FFFFFF' }, fonts: 'gala', ornament: 'stars',
    copy: { kicker: 'One night only', headline: 'Haunted photo booth', footer: '' },
  },
  // Graduation
  {
    id: 'grand-hall', name: 'Grand hall', occasion: 'graduation', layout: 'window', art: designArt('grand-hall'), artFocus: 0.55,
    palette: paper('#F8F3E7', '#ECE1C9', '#1D2A4A', '#4E5A74', '#B08A3A'), fonts: 'gala', ornament: 'rules',
    copy: { kicker: 'Class of the year', headline: 'Caps off to you', footer: '' },
  },
  {
    id: 'big-day', name: 'Big day', occasion: 'graduation', layout: 'glow', art: null, artFocus: 0.5,
    palette: night('#141B3D', '#03040C', '#8EA2FF', 'rgba(14,19,48,0.6)', '#AEB7DA'), fonts: 'modern', beamy: true, ornament: 'stars',
    copy: { kicker: 'We did it', headline: 'Snap the moment', footer: '' },
  },
  // Baby shower
  {
    id: 'balloon-release', name: 'Little one', occasion: 'baby', layout: 'window', art: designArt('balloon-release'), artFocus: 0.45,
    palette: paper('#FDF6F2', '#F7E6E4', '#4B3550', '#7B6A80', '#E59AAE'), fonts: 'classic', ornament: 'sparkles',
    copy: { kicker: 'Oh baby', headline: 'Say cheese!', footer: '' },
  },
  // Festivals
  {
    id: 'owambe', name: 'Owambe', occasion: 'culture', layout: 'glass', art: designArt('owambe'), artFocus: 0.55,
    palette: { ...paper('#FFF6E6', '#F6E2BC', '#3A1A12', '#6E4A36', '#1F8A70'), glass: 'rgba(255,248,236,0.74)' }, fonts: 'gala', ornament: 'rules',
    copy: { kicker: 'Dress to impress', headline: 'Show us your aso ebi', footer: '' },
  },
  {
    id: 'festival-of-lights', name: 'Festival of lights', occasion: 'culture', layout: 'glass', art: designArt('festival-of-lights'), artFocus: 0.3,
    palette: night('#2E1452', '#14082A', '#FFC85A', 'rgba(38,14,70,0.58)'), fonts: 'classic', ornament: 'sparkles',
    copy: { kicker: 'Light up the night', headline: 'Happy Diwali', footer: '' },
  },
  {
    id: 'crescent-night', name: 'Crescent night', occasion: 'culture', layout: 'window', art: designArt('crescent-night'), artFocus: 0.3,
    palette: paper('#F7F1E4', '#ECDDBF', '#16264A', '#4A5A78', '#C99A3A'), fonts: 'classic', ornament: 'stars',
    copy: { kicker: 'Eid mubarak', headline: 'Share the joy', footer: '' },
  },
];

export function templateById(id: string): QrTemplate {
  return QR_TEMPLATES.find((t) => t.id === id) ?? QR_TEMPLATES[0];
}

/* ------------------------------------------------------------------ */
/* Where the code points                                               */
/* ------------------------------------------------------------------ */

export const QR_TARGETS = ['welcome', 'booth', 'upload', 'wall', 'challenges', 'custom'] as const;
export type QrTarget = typeof QR_TARGETS[number];

export const TARGET_INFO: Record<Exclude<QrTarget, 'custom'>, { label: string; path: string; hint: string; message: string }> = {
  welcome: {
    label: 'Welcome page', path: '/welcome', hint: 'Recommended: guests see how it works before the camera asks.',
    message: 'Scan to open our photo booth, try the looks and send your shots to the big screen.',
  },
  booth: {
    label: 'Photo booth', path: '/booth', hint: 'Straight into the camera.',
    message: 'Scan to open the photo booth on your phone and strike a pose.',
  },
  upload: {
    label: 'Upload photos', path: '/upload', hint: 'For photos already on their phone.',
    message: 'Scan to add the photos on your phone to our live wall.',
  },
  wall: {
    label: 'Live wall', path: '/wall', hint: 'Watch every photo arrive.',
    message: 'Scan to watch everyone’s photos arrive on the live wall.',
  },
  challenges: {
    label: 'Photo challenges', path: '/challenges', hint: 'Games and points.',
    message: 'Scan to play tonight’s photo challenges and win points.',
  },
};

export const CUSTOM_MESSAGE = 'Scan the code with your phone camera.';

/** The URL the code encodes, or null when a custom link is not usable yet. */
export function targetUrl(target: QrTarget, eventBase: string | null, customUrl: string): string | null {
  if (target === 'custom' || eventBase === null) return normalizeLink(customUrl);
  return `${eventBase.replace(/\/+$/, '')}${TARGET_INFO[target].path}`;
}

/** Accepts "example.com/x" or a full http(s) URL; anything else is null. */
export function normalizeLink(raw: string): string | null {
  const s = raw.trim();
  if (s === '') return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** What prints under the code for guests who cannot scan: no scheme, no trailing slash. */
export function displayLink(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/* ------------------------------------------------------------------ */
/* The saved design                                                    */
/* ------------------------------------------------------------------ */

export interface QrCardCopy {
  kicker: string;
  headline: string;
  names: string;
  date: string;
  message: string;
  footer: string;
}

export interface QrCardDesign {
  v: 1;
  templateId: string;
  orientation: QrOrientation;
  size: QrSizeId;
  copy: QrCardCopy;
  /** Overrides the template's accent; null = the template's own. */
  accent: string | null;
  target: QrTarget;
  customUrl: string;
  /** Print the link under the code. */
  showLink: boolean;
  /** "Made with Beamwall" along the bottom edge. */
  showCredit: boolean;
}

export const COPY_LIMITS: Record<keyof QrCardCopy, number> = {
  kicker: 40,
  headline: 60,
  names: 60,
  date: 50,
  message: 160,
  footer: 50,
};

/** "Saturday 12 July 2026" from an ISO date, or '' when there is none. */
export function formatCardDate(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m === null) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function defaultDesign(event: { name: string; date?: string | null } | null, templateId = QR_TEMPLATES[0].id): QrCardDesign {
  const t = templateById(templateId);
  return {
    v: 1,
    templateId: t.id,
    orientation: 'portrait',
    size: '5x7',
    copy: {
      kicker: t.copy.kicker,
      headline: t.copy.headline,
      names: (event?.name ?? '').slice(0, COPY_LIMITS.names),
      date: formatCardDate(event?.date ?? null),
      message: TARGET_INFO.welcome.message,
      footer: t.copy.footer,
    },
    accent: null,
    target: 'welcome',
    customUrl: '',
    showLink: true,
    showCredit: true,
  };
}

/** Switching template swaps the template's own words, but never words the host wrote. */
export function applyTemplate(d: QrCardDesign, templateId: string): QrCardDesign {
  const from = templateById(d.templateId);
  const to = templateById(templateId);
  const keep = (field: keyof QrTemplateCopy) => (d.copy[field] === from.copy[field] ? to.copy[field] : d.copy[field]);
  return {
    ...d,
    templateId: to.id,
    accent: null,
    copy: { ...d.copy, kicker: keep('kicker'), headline: keep('headline'), footer: keep('footer') },
  };
}

/** Switching link swaps the message only when it is still the previous link's default. */
export function applyTarget(d: QrCardDesign, target: QrTarget): QrCardDesign {
  const prev = d.target === 'custom' ? CUSTOM_MESSAGE : TARGET_INFO[d.target].message;
  const next = target === 'custom' ? CUSTOM_MESSAGE : TARGET_INFO[target].message;
  return { ...d, target, copy: { ...d.copy, message: d.copy.message === prev ? next : d.copy.message } };
}

const HEX = /^#[0-9a-f]{6}$/i;

const str = (v: unknown, max: number, fallback: string) => (typeof v === 'string' ? v.slice(0, max) : fallback);

/** Total: anything stored (or nothing) comes back as a valid design. */
export function normalizeDesign(raw: unknown, event: { name: string; date?: string | null } | null): QrCardDesign {
  const base = defaultDesign(event);
  if (raw === null || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const t = typeof r.templateId === 'string' && QR_TEMPLATES.some((x) => x.id === r.templateId) ? r.templateId : base.templateId;
  const tpl = templateById(t);
  const c = (r.copy !== null && typeof r.copy === 'object' ? r.copy : {}) as Record<string, unknown>;
  return {
    v: 1,
    templateId: t,
    orientation: r.orientation === 'landscape' ? 'landscape' : 'portrait',
    size: QR_SIZES.some((s) => s.id === r.size) ? (r.size as QrSizeId) : base.size,
    copy: {
      kicker: str(c.kicker, COPY_LIMITS.kicker, tpl.copy.kicker),
      headline: str(c.headline, COPY_LIMITS.headline, tpl.copy.headline),
      names: str(c.names, COPY_LIMITS.names, base.copy.names),
      date: str(c.date, COPY_LIMITS.date, base.copy.date),
      message: str(c.message, COPY_LIMITS.message, base.copy.message),
      footer: str(c.footer, COPY_LIMITS.footer, tpl.copy.footer),
    },
    accent: typeof r.accent === 'string' && HEX.test(r.accent) ? r.accent : null,
    target: (QR_TARGETS as readonly string[]).includes(r.target as string) ? (r.target as QrTarget) : base.target,
    customUrl: str(r.customUrl, 500, ''),
    showLink: r.showLink !== false,
    showCredit: r.showCredit !== false,
  };
}

/** A file name for the download: "ada-tunde-qr-card-5x7-portrait.png". */
export function exportFileName(d: QrCardDesign, ext: 'png' | 'pdf'): string {
  const base = (d.copy.names || d.copy.headline || 'beamwall')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'beamwall';
  return `${base}-qr-card-${d.size}-${d.orientation}.${ext}`;
}

/* ------------------------------------------------------------------ */
/* Colour helpers (contrast checks for the code)                       */
/* ------------------------------------------------------------------ */

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function relativeLuminance(hex: string): number {
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Accent swatches offered in the Style tab. */
export const ACCENT_SWATCHES = ['#B8913F', '#E0478A', '#F06A4A', '#1F8A70', '#5B6CFF', '#B8323A', '#8C9B79', '#FFFFFF'] as const;
