/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * qrCards/model — the printable QR card generator's data: the template
 * library, the print sizes, the guest links a code can point at, and the
 * saved design (`events.config.qrCard`).
 *
 * A template is a whole look: a full-page painted scene per orientation
 * (sceneArt.ts) with a plain spot that suits the theme (a garden sign, a gift
 * tag, a marquee, the moon...) where the code is printed, a palette, a font
 * set and a starting headline. The words are printed straight onto the
 * painting, no panels. The host changes words, accent colour, link, size and
 * orientation; the template keeps everything else, so every card that leaves
 * the generator stays designed.
 *
 * PURE: no React, no DOM, no supabase.
 */
import { SCENE_ART } from './sceneArt';

/* ------------------------------------------------------------------ */
/* Occasions and sizes                                                 */
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
  /** Words on the darker parts of the scene. */
  light: string;
  /** Words on the paler parts of the scene. */
  dark: string;
  /** The fine rule under the headline. */
  accent: string;
  /** The code's modules. Always dark: scanners need dark on light. */
  qrInk: string;
}

/* ------------------------------------------------------------------ */
/* Scene art                                                           */
/* ------------------------------------------------------------------ */

/** Which ink the words need where they sit: light words on dark art, or dark on light. */
export type InkTone = 'light' | 'dark';

export interface SceneArt {
  /** Full picture (print) and a small one for the gallery. */
  src: string;
  thumb: string;
  /** Width / height of the picture. */
  aspect: number;
  /** The plain square the code is printed on: centre as fractions of the picture, s = side as a fraction of its width. */
  spot: { x: number; y: number; s: number };
  /** The whole painted holder round the spot (a card, a frame, the moon), as fractions; words keep off it. */
  hold: { x0: number; y0: number; x1: number; y1: number };
  /** The spot's face colour (the code is printed straight onto it). */
  face: string;
  /** The picture's mean colour, painted first. */
  base: string;
  /** Ink above the spot (portrait) / in the word column (landscape), and below the spot. */
  text: { top: InkTone; below: InkTone };
}

export interface SceneArtSet { portrait: SceneArt; landscape: SceneArt }

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

export interface QrTemplate {
  id: string;
  name: string;
  occasion: QrOccasion;
  art: SceneArtSet;
  palette: QrPalette;
  fonts: QrFontSetId;
  /** The starting headline. */
  headline: string;
}

const art = (id: string): SceneArtSet => SCENE_ART[id];
const pal = (light: string, dark: string, accent: string, qrInk: string): QrPalette => ({ light, dark, accent, qrInk });

export const QR_TEMPLATES: readonly QrTemplate[] = [
  // Weddings
  { id: 'moonlit-arch', name: 'Moonlit arch', occasion: 'wedding', art: art('moonlit-arch'), palette: pal('#FFF6EC', '#1B1640', '#E8B98F', '#1B1640'), fonts: 'classic', headline: 'Strike a pose' },
  { id: 'garden-vows', name: 'Garden vows', occasion: 'wedding', art: art('garden-vows'), palette: pal('#FFFBF2', '#33402F', '#B8A27A', '#26301F'), fonts: 'classic', headline: 'Share the love' },
  { id: 'grand-ballroom', name: 'Grand ballroom', occasion: 'wedding', art: art('grand-ballroom'), palette: pal('#FFF4DC', '#1E2340', '#C9A24B', '#1E2340'), fonts: 'gala', headline: 'Photo booth' },
  // Birthdays
  { id: 'balloon-bash', name: 'Balloon bash', occasion: 'birthday', art: art('balloon-bash'), palette: pal('#FFF8F0', '#3B1E45', '#F06A4A', '#3B1E45'), fonts: 'party', headline: 'Snap, pose, share!' },
  { id: 'party-pop', name: 'Party pop', occasion: 'birthday', art: art('party-pop'), palette: pal('#FFF8F3', '#43204F', '#E0478A', '#43204F'), fonts: 'party', headline: 'Pop into the booth' },
  { id: 'jungle-jam', name: 'Jungle jam', occasion: 'birthday', art: art('jungle-jam'), palette: pal('#FFFBEA', '#1F3B2A', '#E8812E', '#1F3B2A'), fonts: 'party', headline: 'Wild photo booth' },
  // Anniversaries
  { id: 'golden-hour', name: 'Golden hour', occasion: 'anniversary', art: art('golden-hour'), palette: pal('#FFF7E8', '#4A2F17', '#C58A2E', '#3A2412'), fonts: 'classic', headline: 'Celebrate with us' },
  { id: 'love-notes', name: 'Love notes', occasion: 'anniversary', art: art('love-notes'), palette: pal('#FFF2F5', '#3A1D4A', '#F2A7B8', '#2B1A4A'), fonts: 'classic', headline: 'Snap a memory' },
  // Retirement
  { id: 'island-sunset', name: 'Island sunset', occasion: 'retirement', art: art('island-sunset'), palette: pal('#FFF6EE', '#3A2140', '#E86A4A', '#3A2140'), fonts: 'classic', headline: 'Cheers to you' },
  { id: 'cloud-nine', name: 'Cloud nine', occasion: 'retirement', art: art('cloud-nine'), palette: pal('#FFFAF6', '#4A2C4E', '#E68A7E', '#3E2442'), fonts: 'classic', headline: 'Happy retirement' },
  // Corporate
  { id: 'city-lights', name: 'City lights', occasion: 'corporate', art: art('city-lights'), palette: pal('#FFF6E2', '#151A3C', '#FFC96B', '#151A3C'), fonts: 'modern', headline: 'Get on the big screen' },
  { id: 'beam-brand', name: 'Beam', occasion: 'corporate', art: art('beam-brand'), palette: pal('#F4F4FF', '#1E1D5C', '#B9BCFF', '#17165A'), fonts: 'modern', headline: 'Beam your photo to the wall' },
  // Product launches
  { id: 'showtime', name: 'Showtime', occasion: 'launch', art: art('showtime'), palette: pal('#FFF4E4', '#3E0F1C', '#E0B04F', '#3E0F1C'), fonts: 'gala', headline: 'The big reveal' },
  { id: 'gold-reveal', name: 'Gold reveal', occasion: 'launch', art: art('gold-reveal'), palette: pal('#FFF3D6', '#2B1F0A', '#E2B45A', '#2B1F0A'), fonts: 'modern', headline: 'See it before anyone' },
  // Christmas
  { id: 'winter-glow', name: 'Winter glow', occasion: 'christmas', art: art('winter-glow'), palette: pal('#FFFBF2', '#173A34', '#C9A45A', '#13302B'), fonts: 'classic', headline: 'Jingle all the way' },
  { id: 'silent-night', name: 'Silent night', occasion: 'christmas', art: art('silent-night'), palette: pal('#FFF8E6', '#173A34', '#E2C27A', '#13302B'), fonts: 'gala', headline: 'Smile, it’s Christmas' },
  // Halloween
  { id: 'pumpkin-moon', name: 'Pumpkin moon', occasion: 'halloween', art: art('pumpkin-moon'), palette: pal('#FFF1E0', '#2A0F3A', '#FFA94D', '#2A0F3A'), fonts: 'party', headline: 'Spooky snaps' },
  { id: 'spellbound', name: 'Spellbound', occasion: 'halloween', art: art('spellbound'), palette: pal('#F8F0FF', '#2A0F3A', '#B98AE8', '#2A0F3A'), fonts: 'gala', headline: 'Haunted photo booth' },
  // Graduation
  { id: 'grand-hall', name: 'Grand hall', occasion: 'graduation', art: art('grand-hall'), palette: pal('#FFF8EA', '#1D2A4A', '#B08A3A', '#1D2A4A'), fonts: 'gala', headline: 'Caps off to you' },
  { id: 'big-day', name: 'Big day', occasion: 'graduation', art: art('big-day'), palette: pal('#FFF8F0', '#141B3D', '#E8B66B', '#141B3D'), fonts: 'modern', headline: 'Snap the moment' },
  // Baby shower
  { id: 'balloon-release', name: 'Little one', occasion: 'baby', art: art('balloon-release'), palette: pal('#FFFAFC', '#4B3550', '#E59AAE', '#4B3550'), fonts: 'classic', headline: 'Say cheese!' },
  // Festivals
  { id: 'owambe', name: 'Owambe', occasion: 'culture', art: art('owambe'), palette: pal('#FFF6E6', '#3A1A12', '#D9A441', '#3A1A12'), fonts: 'gala', headline: 'Show us your aso ebi' },
  { id: 'festival-of-lights', name: 'Festival of lights', occasion: 'culture', art: art('festival-of-lights'), palette: pal('#FFF4DA', '#2E1452', '#FFC85A', '#2E1452'), fonts: 'classic', headline: 'Happy Diwali' },
  { id: 'crescent-night', name: 'Crescent night', occasion: 'culture', art: art('crescent-night'), palette: pal('#FFF7E6', '#16264A', '#D9AE52', '#16264A'), fonts: 'classic', headline: 'Eid mubarak' },
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
    message: 'Scan to open our photo booth',
  },
  booth: {
    label: 'Photo booth', path: '/booth', hint: 'Straight into the camera.',
    message: 'Scan to strike a pose',
  },
  upload: {
    label: 'Upload photos', path: '/upload', hint: 'For photos already on their phone.',
    message: 'Scan to share your photos',
  },
  wall: {
    label: 'Live wall', path: '/wall', hint: 'Watch every photo arrive.',
    message: 'Scan to see the live wall',
  },
  challenges: {
    label: 'Photo challenges', path: '/challenges', hint: 'Games and points.',
    message: 'Scan to join the photo challenges',
  },
};

export const CUSTOM_MESSAGE = 'Scan with your phone camera';

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
  headline: string;
  names: string;
  date: string;
  /** The one line under the code: "Scan to open our photo booth". */
  message: string;
}

export interface QrCardDesign {
  v: 1;
  templateId: string;
  orientation: QrOrientation;
  size: QrSizeId;
  copy: QrCardCopy;
  /** Overrides the template's accent colour; null = the template's own. */
  accent: string | null;
  target: QrTarget;
  customUrl: string;
}

export const COPY_LIMITS: Record<keyof QrCardCopy, number> = {
  headline: 60,
  names: 60,
  date: 50,
  message: 60,
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
      headline: t.headline,
      names: (event?.name ?? '').slice(0, COPY_LIMITS.names),
      date: formatCardDate(event?.date ?? null),
      message: TARGET_INFO.welcome.message,
    },
    accent: null,
    target: 'welcome',
    customUrl: '',
  };
}

/** Switching template swaps the template's own headline, but never one the host wrote. */
export function applyTemplate(d: QrCardDesign, templateId: string): QrCardDesign {
  const from = templateById(d.templateId);
  const to = templateById(templateId);
  return {
    ...d,
    templateId: to.id,
    accent: null,
    copy: { ...d.copy, headline: d.copy.headline === from.headline ? to.headline : d.copy.headline },
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
      headline: str(c.headline, COPY_LIMITS.headline, tpl.headline),
      names: str(c.names, COPY_LIMITS.names, base.copy.names),
      date: str(c.date, COPY_LIMITS.date, base.copy.date),
      message: str(c.message, COPY_LIMITS.message, base.copy.message),
    },
    accent: typeof r.accent === 'string' && HEX.test(r.accent) ? r.accent : null,
    target: (QR_TARGETS as readonly string[]).includes(r.target as string) ? (r.target as QrTarget) : base.target,
    customUrl: str(r.customUrl, 500, ''),
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
