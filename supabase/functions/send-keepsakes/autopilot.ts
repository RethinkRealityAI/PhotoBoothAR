/**
 * autopilot — the pure half of the next-day keepsake (migration 050).
 *
 * WHEN an event's keepsake goes out, WHICH photos make its film, and WHAT the
 * film is told. No Deno, no fetch, no Supabase: index.ts does the I/O and this
 * file decides, so the rules are typechecked and tested from vitest
 * (src/lib/keepsakeAutopilot.test.ts) the same way ai-event-designer/prompt.ts
 * is. Deploy it beside index.ts — a missing sibling is an import error at boot.
 *
 * THE SCHEDULE, in one sentence: the morning after the event.
 *   • `starts_at` is the event DATE, written by updateEventDate as that day's
 *     LOCAL midnight. +34h is therefore 10:00 local the next day, whatever the
 *     host's timezone, without the server ever knowing the timezone.
 *   • A host who ends the event (status → ended, stamped ended_at by 050's
 *     trigger) gets it 12h after they pressed End, so "ended at 11pm" also
 *     lands mid-morning.
 *   • Whichever comes FIRST wins.
 *   • Nothing older than 7 days is ever picked up. This is what stops the very
 *     first deploy from mailing every guest of every event since July.
 *   • A host can turn it off per event (config.keepsakes.autoSend === false).
 */

export const NEXT_MORNING_OFFSET_MS = 34 * 60 * 60 * 1000;
export const AFTER_END_DELAY_MS = 12 * 60 * 60 * 1000;
export const MAX_LATE_MS = 7 * 24 * 60 * 60 * 1000;
/** A claim this old whose worker never reported back is treated as dead. */
export const STALE_CLAIM_MS = 3 * 60 * 60 * 1000;
/** Claims per event before the autopilot stops trying the film and just mails. */
export const MAX_ATTEMPTS = 2;
/** Fewer photos than this and there is no film worth making — the email still goes. */
export const FILM_MIN_PHOTOS = 4;
/** Title 4.2s + 6 × 5.4s + closing 4.6s ≈ 41s: a short film, not a slideshow. */
export const FILM_MAX_PHOTOS = 6;
/** Events handed to one worker run. Each film is minutes of render time. */
export const MAX_DUE_PER_RUN = 5;

export interface ScheduleEvent {
  status: string | null;
  starts_at: string | null;
  ended_at: string | null;
  config: unknown;
}

function ms(iso: string | null): number | null {
  if (iso === null) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** The host's per-event switch. Absent = on: it is the default, and the copy
 *  in Share & Print says so. Only an explicit `false` turns it off. */
export function autoSendEnabled(config: unknown): boolean {
  if (config === null || typeof config !== 'object') return true;
  const k = (config as { keepsakes?: unknown }).keepsakes;
  if (k === null || typeof k !== 'object') return true;
  return (k as { autoSend?: unknown }).autoSend !== false;
}

/** When this event's keepsake is due (epoch ms), or null when it never is. */
export function keepsakeDueAt(ev: ScheduleEvent): number | null {
  const status = ev.status ?? '';
  if (status !== 'live' && status !== 'ended' && status !== 'archived') return null;
  const fromDate = ms(ev.starts_at);
  const fromEnd = status === 'live' ? null : ms(ev.ended_at);
  const candidates: number[] = [];
  if (fromDate !== null) candidates.push(fromDate + NEXT_MORNING_OFFSET_MS);
  if (fromEnd !== null) candidates.push(fromEnd + AFTER_END_DELAY_MS);
  return candidates.length === 0 ? null : Math.min(...candidates);
}

/** Due now: past its time, not more than MAX_LATE_MS past it, and not switched off. */
export function isKeepsakeDue(ev: ScheduleEvent, now: number): boolean {
  if (!autoSendEnabled(ev.config)) return false;
  const due = keepsakeDueAt(ev);
  return due !== null && now >= due && now - due <= MAX_LATE_MS;
}

export interface RunRow {
  status: string;
  attempts: number;
  claimed_at: string;
}

/**
 * May a worker (re)claim an event whose run row already exists, and how?
 * Only a claim that went silent (its worker died before reporting back).
 *   'film'       attempts left: try the whole thing again.
 *   'email_only' the film has had its MAX_ATTEMPTS: mail the album without it,
 *                because a film that keeps killing the worker must never cost
 *                the guests their photos.
 *   null         finished, fresh, or already given its last chance.
 */
export function reclaimMode(row: RunRow, now: number): 'film' | 'email_only' | null {
  if (row.status !== 'claimed') return null;
  const at = ms(row.claimed_at);
  if (at === null || now - at < STALE_CLAIM_MS) return null;
  if (row.attempts < MAX_ATTEMPTS) return 'film';
  if (row.attempts === MAX_ATTEMPTS) return 'email_only';
  return null;
}

/** The film is a paid-plan feature: the same line the resolver already draws
 *  between free (watermarked) and every paid tier. Fail closed on a missing
 *  answer — no film is the safe default; the email goes either way. */
export function filmEntitled(features: unknown): boolean {
  if (features === null || typeof features !== 'object') return false;
  return (features as { watermark?: unknown }).watermark === false;
}

/* ── The film ──────────────────────────────────────────────────────────── */

export interface FilmPost {
  id: string;
  image_url: string | null;
  media_type: string | null;
  guest_name: string | null;
  message: string | null;
  created_at: string;
}

/**
 * Up to FILM_MAX_PHOTOS stills, spread evenly across the night (first shot,
 * last shot and the moments between), oldest first so the film runs in the
 * order the night did. Videos are left out: a 6-scene film should not spend
 * 15 seconds on one clip, and the album has them all.
 */
export function pickFilmPhotos(posts: FilmPost[], max = FILM_MAX_PHOTOS): FilmPost[] {
  const stills = posts
    .filter((p) => p.media_type !== 'video' && typeof p.image_url === 'string' && p.image_url.startsWith('https://'))
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
  if (stills.length <= max) return stills;
  if (max <= 1) return stills.slice(0, Math.max(0, max));
  const out: FilmPost[] = [];
  for (let i = 0; i < max; i += 1) {
    out.push(stills[Math.round((i * (stills.length - 1)) / (max - 1))]);
  }
  return out;
}

/* ── The host's film choices (events.config.keepsakes) ─────────────────────
 * MIRRORS of src/lib/keepsakeSettings.ts — this file is deployed alone with
 * index.ts and cannot import src/. src/lib/keepsakeAutopilot.test.ts pins the
 * ids, palettes, defaults and copy caps to that file, so a theme or track added
 * there without being added here goes red. The film worker imports THIS
 * normaliser too (scripts/keepsake-worker.mjs), so the edge fn and the worker
 * can never disagree on what an id means.
 */
export const FILM_THEME_IDS = ['beamwall', 'golden-hour', 'midnight-bloom', 'confetti', 'ivory'] as const;
export type FilmThemeId = (typeof FILM_THEME_IDS)[number];
export const FILM_MUSIC_IDS = ['glow', 'celebrate', 'elegance', 'tender', 'nightlife', 'none'] as const;
export type FilmMusicId = (typeof FILM_MUSIC_IDS)[number];

export interface FilmPalette {
  background: string;
  surface: string;
  ink: string;
  muted: string;
  accent: string;
  glow: string;
}

export const FILM_THEME_PALETTES: Record<FilmThemeId, FilmPalette> = {
  beamwall: { background: '#07060f', surface: '#141127', ink: '#f5f3ff', muted: '#a9a3c9', accent: '#8b7dff', glow: '#ffb54d' },
  'golden-hour': { background: '#1a0f07', surface: '#2a1a0d', ink: '#fff4e3', muted: '#d6b994', accent: '#f2b356', glow: '#ff8a3d' },
  'midnight-bloom': { background: '#060b1a', surface: '#0f1a33', ink: '#eef3ff', muted: '#9fb0d6', accent: '#ff7eb6', glow: '#7ec8ff' },
  confetti: { background: '#120a24', surface: '#1f1238', ink: '#ffffff', muted: '#c9bde8', accent: '#ffd23f', glow: '#ff5fa2' },
  ivory: { background: '#f7f3ec', surface: '#ffffff', ink: '#1d1a15', muted: '#6f675b', accent: '#b08a4a', glow: '#e8d3a8' },
};

export const FILM_DEFAULT_THEME: FilmThemeId = 'beamwall';
export const FILM_DEFAULT_MUSIC: FilmMusicId = 'glow';
export const FILM_DEFAULT_SIGN_OFF = 'With love,';
export const FILM_COPY_MAX = { signOff: 40, hostName: 60 } as const;

export interface FilmChoice {
  theme: FilmThemeId;
  music: FilmMusicId;
}

function oneOf<T extends string>(set: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (set as readonly string[]).includes(v);
}

/** `{ theme, music }` from `config.keepsakes` (or from a payload's `keepsake`
 *  block). TOTAL: absent, unknown or junk → beamwall + glow. */
export function filmChoice(keepsakes: unknown): FilmChoice {
  const k = keepsakes !== null && typeof keepsakes === 'object' ? (keepsakes as Record<string, unknown>) : {};
  return {
    theme: oneOf(FILM_THEME_IDS, k.theme) ? k.theme : FILM_DEFAULT_THEME,
    music: oneOf(FILM_MUSIC_IDS, k.music) ? k.music : FILM_DEFAULT_MUSIC,
  };
}

/** The composition's colour keys for a theme (it reads bg/fg/accent first). */
export function filmThemeColors(theme: FilmThemeId): Record<string, string> {
  const p = FILM_THEME_PALETTES[theme] ?? FILM_THEME_PALETTES[FILM_DEFAULT_THEME];
  return { bg: p.background, surface: p.surface, fg: p.ink, muted: p.muted, accent: p.accent, glow: p.glow };
}

/** Same cleaning as keepsakeSettings' cleanText: control chars out, one line, capped. */
function filmText(v: unknown, max: number, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t === '') return fallback;
  return t.length > max ? t.slice(0, max) : t;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * "Saturday, 5 December 2026" from `starts_at`, or null. `starts_at` is the
 * event day's LOCAL midnight; +12h then the UTC calendar day recovers that day
 * for every offset from UTC-12 to UTC+12 without knowing the host's zone.
 * Formatted by hand, not Intl, so the film text never depends on the runner.
 */
export function filmDateLine(startsAt: string | null): string | null {
  if (startsAt === null) return null;
  const t = Date.parse(startsAt);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + 12 * 60 * 60 * 1000);
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Same shape card-render hands the keepsake-film composition. */
export interface EventFilmPayload {
  card: {
    title: string;
    recipientName: null;
    eventName: string | null;
    template: 'storybook';
    theme: Record<string, string>;
    countLabel: string;
    closingEyebrow: string;
    closingTitle: string;
    /** Present when the host's keepsake settings were passed (see below). */
    dateLine?: string | null;
    signOff?: string;
    hostName?: string;
  };
  /** The host's theme + music. An older worker ignores it; a newer worker
   *  reading a payload without it falls back to beamwall + glow. */
  keepsake?: FilmChoice;
  contributions: Array<{
    contributorName: string | null;
    message: string | null;
    mediaType: 'photo';
    url: string;
    durationSeconds: null;
    /** Booth shots are portrait; the film is 16:9. "contain" keeps the whole
     *  photo in frame over a blurred copy instead of cropping it to a mouth. */
    fit: 'contain';
  }>;
}

const HEX_RE = /^#[0-9a-f]{6}$/i;

function clip(s: string | null, n: number): string | null {
  if (s === null) return null;
  const t = s.trim();
  return t === '' ? null : t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export function buildEventFilmPayload(opts: {
  eventName: string;
  accent: string | null;
  photos: FilmPost[];
  totalPhotos: number;
  /** `events.config.keepsakes` + `starts_at`. Absent = the pre-theme payload
   *  (event accent only), byte-for-byte what older callers produced. */
  keepsake?: { settings: unknown; startsAt: string | null };
}): EventFilmPayload {
  let theme: Record<string, string> = {};
  if (opts.accent !== null && HEX_RE.test(opts.accent)) theme.accent = opts.accent;
  const n = opts.totalPhotos;
  let extra: Pick<EventFilmPayload['card'], 'dateLine' | 'signOff' | 'hostName'> = {};
  let keepsake: FilmChoice | undefined;
  if (opts.keepsake) {
    keepsake = filmChoice(opts.keepsake.settings);
    // The host's theme wins over the event accent: they picked it for the film.
    theme = filmThemeColors(keepsake.theme);
    const s = opts.keepsake.settings;
    const copy = s !== null && typeof s === 'object' ? (s as { copy?: unknown }).copy : null;
    const c = copy !== null && typeof copy === 'object' ? (copy as Record<string, unknown>) : {};
    extra = {
      dateLine: filmDateLine(opts.keepsake.startsAt),
      signOff: filmText(c.signOff, FILM_COPY_MAX.signOff, FILM_DEFAULT_SIGN_OFF),
      // Empty host name → the event signs it (the brief's rule for the film).
      hostName: filmText(c.hostName, FILM_COPY_MAX.hostName, '') || opts.eventName,
    };
  }
  return {
    card: {
      title: opts.eventName,
      recipientName: null,
      eventName: 'The night in pictures',
      template: 'storybook',
      theme,
      countLabel: `${n} ${n === 1 ? 'photo' : 'photos'} from the booth`,
      closingEyebrow: 'Thank you for coming',
      closingTitle: opts.eventName,
      ...extra,
    },
    ...(keepsake ? { keepsake } : {}),
    contributions: opts.photos.map((p) => ({
      contributorName: clip(p.guest_name, 40),
      message: clip(p.message, 140),
      mediaType: 'photo',
      url: p.image_url as string,
      durationSeconds: null,
      fit: 'contain',
    })),
  };
}

/** Where an event's film and its poster frame live in the public posts bucket.
 *  Under the event's own prefix, so delete-event's sweep removes them. */
export function filmPaths(slug: string): { film: string; poster: string } {
  return { film: `${slug}/_film/keepsake.mp4`, poster: `${slug}/_film/poster.jpg` };
}

/** Constant-time compare of the worker's shared secret. An unset or short
 *  secret refuses everything rather than accepting an empty header. */
export function workerAuthorized(header: string | null, secret: string | undefined): boolean {
  if (typeof secret !== 'string' || secret.length < 32) return false;
  if (typeof header !== 'string' || header.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i += 1) diff |= header.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}
