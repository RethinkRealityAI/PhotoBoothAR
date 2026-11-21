/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * keepsakeSettings — how a host's next-day keepsake looks, reads and sounds.
 *
 * Stored in `events.config.keepsakes` (jsonb, no migration), beside the
 * existing `autoSend` switch that send-keepsakes/autopilot.ts reads. Three
 * readers share this one shape:
 *   • the album page /r/:slug (theme, intro, Beamy greeting, downloads),
 *   • the host's Keepsake editor (Share & Print, and the wizard step),
 *   • send-keepsakes, which hands `theme` + `music` to the film worker.
 *
 * PURE (no React, no DOM, no supabase) so every rule is tested in vitest's node
 * env. TOTAL: `normalizeKeepsakeSettings` never throws and always returns
 * settings this build can render — a hand-edited row, a newer build's id or
 * junk all fall back to the defaults, because a keepsake link already mailed to
 * a hundred guests must always open.
 */

/* ------------------------------------------------------------------ */
/* Closed sets                                                         */
/* ------------------------------------------------------------------ */

export type KeepsakeThemeId = 'beamwall' | 'golden-hour' | 'midnight-bloom' | 'confetti' | 'ivory';
export const KEEPSAKE_THEME_IDS = ['beamwall', 'golden-hour', 'midnight-bloom', 'confetti', 'ivory'] as const;

/** The music bed under the film. 'none' = silent film. Track files, titles and
 *  license records live in src/lib/keepsakeMusic.ts (the library). */
export type KeepsakeMusicId = 'none' | 'glow' | 'celebrate' | 'elegance' | 'tender' | 'nightlife';
export const KEEPSAKE_MUSIC_IDS = ['glow', 'celebrate', 'elegance', 'tender', 'nightlife', 'none'] as const;

/** The tap-to-open moment before the album (like the birthday cards).
 *  'beam' = Beamwall's own; the rest reuse the card reveals
 *  (src/components/cards/reveals, ids from lib/cardPresentation). */
export type KeepsakeRevealId = 'beam' | 'envelope' | 'ribbon' | 'curtain' | 'airplane' | 'stardust' | 'papercut' | 'none';
export const KEEPSAKE_REVEAL_IDS = ['beam', 'envelope', 'ribbon', 'curtain', 'airplane', 'stardust', 'papercut', 'none'] as const;

/** What a guest may take home from the album page. */
export type KeepsakeDownloadId = 'film' | 'collage' | 'photos';
export const KEEPSAKE_DOWNLOAD_IDS = ['film', 'collage', 'photos'] as const;

export interface KeepsakeThemeOption {
  id: KeepsakeThemeId;
  label: string;
  /** One line a host can decide from. */
  description: string;
  /** Page + film palette. The film reads accent/background/ink. */
  palette: { background: string; surface: string; ink: string; muted: string; accent: string; glow: string };
  /** The opening moment on the album page before the content settles. */
  intro: 'beam' | 'curtain' | 'confetti' | 'petals' | 'fade';
}

export const KEEPSAKE_THEMES: readonly KeepsakeThemeOption[] = [
  {
    id: 'beamwall',
    label: 'Beamwall',
    description: 'Deep night with a beam of light that sweeps the photos in.',
    palette: { background: '#07060f', surface: '#141127', ink: '#f5f3ff', muted: '#a9a3c9', accent: '#8b7dff', glow: '#ffb54d' },
    intro: 'beam',
  },
  {
    id: 'golden-hour',
    label: 'Golden hour',
    description: 'Warm amber light, like the last hour of a wedding reception.',
    palette: { background: '#1a0f07', surface: '#2a1a0d', ink: '#fff4e3', muted: '#d6b994', accent: '#f2b356', glow: '#ff8a3d' },
    intro: 'curtain',
  },
  {
    id: 'midnight-bloom',
    label: 'Midnight bloom',
    description: 'Inky blue with soft petals drifting across the page.',
    palette: { background: '#060b1a', surface: '#0f1a33', ink: '#eef3ff', muted: '#9fb0d6', accent: '#ff7eb6', glow: '#7ec8ff' },
    intro: 'petals',
  },
  {
    id: 'confetti',
    label: 'Confetti',
    description: 'Bright and playful, opens with a burst of confetti.',
    palette: { background: '#120a24', surface: '#1f1238', ink: '#ffffff', muted: '#c9bde8', accent: '#ffd23f', glow: '#ff5fa2' },
    intro: 'confetti',
  },
  {
    id: 'ivory',
    label: 'Ivory',
    description: 'Light, quiet and classic, with a gentle fade in.',
    palette: { background: '#f7f3ec', surface: '#ffffff', ink: '#1d1a15', muted: '#6f675b', accent: '#b08a4a', glow: '#e8d3a8' },
    intro: 'fade',
  },
];

export function keepsakeTheme(id: KeepsakeThemeId): KeepsakeThemeOption {
  return KEEPSAKE_THEMES.find((t) => t.id === id) ?? KEEPSAKE_THEMES[0];
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

/** Copy limits, shared by the editor's counters and the normaliser. */
export const KEEPSAKE_COPY_MAX = { headline: 80, message: 280, signOff: 40, hostName: 60 } as const;

export interface KeepsakeCopy {
  /** Beamy's opening line. Tokens: {event} {photos} {guests} {when} {host}. */
  headline: string;
  message: string;
  /** "With love," */
  signOff: string;
  /** Who signs it. Empty = the host's organisation name. */
  hostName: string;
}

export interface KeepsakeSettings {
  /** Next-day email on/off (read by send-keepsakes/autopilot.ts). */
  autoSend: boolean;
  theme: KeepsakeThemeId;
  /** The opening moment. Independent of theme: theme = colours, reveal = how it opens. */
  reveal: KeepsakeRevealId;
  music: KeepsakeMusicId;
  /** Beamy greets guests at the top of the album. */
  beamy: boolean;
  /** Which take-home options the album offers. At least one is always on. */
  downloads: Record<KeepsakeDownloadId, boolean>;
  copy: KeepsakeCopy;
}

export const DEFAULT_KEEPSAKE_COPY: KeepsakeCopy = {
  headline: '{when}{event} was a hit!',
  message: 'Thanks for being part of it. {photos} were shared on the night, and they are all right here.',
  signOff: 'With love,',
  hostName: '',
};

export const DEFAULT_KEEPSAKE_SETTINGS: KeepsakeSettings = {
  autoSend: true,
  theme: 'beamwall',
  reveal: 'beam',
  music: 'glow',
  beamy: true,
  downloads: { film: true, collage: true, photos: true },
  copy: DEFAULT_KEEPSAKE_COPY,
};

function isOneOf<T extends string>(set: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (set as readonly string[]).includes(v);
}

function cleanText(v: unknown, max: number, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  // Strip control characters; keep the host's own line breaks out of headings.
  const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t === '') return fallback;
  return t.length > max ? t.slice(0, max) : t;
}

/** Read `events.config.keepsakes` into settings this build can render. */
export function normalizeKeepsakeSettings(raw: unknown): KeepsakeSettings {
  const r = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_KEEPSAKE_SETTINGS;
  const dl = r.downloads !== null && typeof r.downloads === 'object' ? (r.downloads as Record<string, unknown>) : {};
  const downloads: Record<KeepsakeDownloadId, boolean> = {
    film: dl.film !== false,
    collage: dl.collage !== false,
    photos: dl.photos !== false,
  };
  // An album with nothing to take home is never what a host meant.
  if (!downloads.film && !downloads.collage && !downloads.photos) downloads.photos = true;
  const c = r.copy !== null && typeof r.copy === 'object' ? (r.copy as Record<string, unknown>) : {};
  const hostRaw = typeof c.hostName === 'string' ? c.hostName : '';
  return {
    autoSend: r.autoSend !== false,
    theme: isOneOf(KEEPSAKE_THEME_IDS, r.theme) ? r.theme : d.theme,
    reveal: isOneOf(KEEPSAKE_REVEAL_IDS, r.reveal) ? r.reveal : d.reveal,
    music: isOneOf(KEEPSAKE_MUSIC_IDS, r.music) ? r.music : d.music,
    beamy: r.beamy !== false,
    downloads,
    copy: {
      headline: cleanText(c.headline, KEEPSAKE_COPY_MAX.headline, d.copy.headline),
      message: cleanText(c.message, KEEPSAKE_COPY_MAX.message, d.copy.message),
      signOff: cleanText(c.signOff, KEEPSAKE_COPY_MAX.signOff, d.copy.signOff),
      hostName: cleanText(hostRaw, KEEPSAKE_COPY_MAX.hostName, ''),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Copy tokens                                                         */
/* ------------------------------------------------------------------ */

export interface KeepsakeCopyContext {
  eventName: string;
  /** Stills + clips on the wall. */
  photos: number;
  /** Distinct devices that posted. */
  guests: number;
  /** The event's date (`starts_at`), ISO, or null. */
  eventDate: string | null;
  /** Now, epoch ms — injected so the copy is testable. */
  now: number;
  /** Fallback signer when copy.hostName is empty (the org's name). */
  orgName: string;
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

/**
 * "Yesterday's " / "Saturday's " / "" — the {when} token, possessive, with its
 * trailing space. Honest about time: an album opened a month later must not say
 * "yesterday". Day difference is measured in UTC because `starts_at` is stored
 * as the event day's midnight.
 */
export function whenPhrase(eventDate: string | null, now: number): string {
  if (eventDate === null) return '';
  const t = Date.parse(eventDate);
  if (!Number.isFinite(t)) return '';
  const day = 24 * 60 * 60 * 1000;
  const days = Math.floor(now / day) - Math.floor(t / day);
  if (days === 0) return "Tonight's ";
  if (days === 1) return "Yesterday's ";
  if (days >= 2 && days <= 6) {
    const name = new Date(t).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    return `${name}'s `;
  }
  return '';
}

/** Fill a copy template. Unknown tokens are left as typed, never thrown on. */
export function fillKeepsakeCopy(template: string, ctx: KeepsakeCopyContext, hostName: string): string {
  const host = hostName.trim() || ctx.orgName.trim() || 'your host';
  const values: Record<string, string> = {
    event: ctx.eventName.trim() || 'the event',
    photos: plural(ctx.photos, 'photo', 'photos'),
    guests: plural(ctx.guests, 'guest', 'guests'),
    when: whenPhrase(ctx.eventDate, ctx.now),
    host,
  };
  // "{when}{event}" with an event named "The Okafor Gala" must read
  // "Yesterday's Okafor Gala", not "Yesterday's The Okafor Gala".
  const eventAfterWhen = values.event.replace(/^the\s+/i, '');
  const out = template
    .replace(/\{when\}\{event\}/g, () => (values.when === '' ? values.event : values.when + eventAfterWhen))
    .replace(/\{(event|photos|guests|when|host)\}/g, (_, k: string) => values[k]);
  // "{when}" is possessive-with-space, so a headline that starts with it should
  // still start with a capital whether {when} filled or not.
  return out.length > 0 ? out[0].toUpperCase() + out.slice(1) : out;
}
