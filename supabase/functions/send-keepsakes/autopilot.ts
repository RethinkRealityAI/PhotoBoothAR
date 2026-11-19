/**
 * autopilot — the pure half of the next-day keepsake (migration 045).
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
 *   • A host who ends the event (status → ended, stamped ended_at by 045's
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
  };
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
}): EventFilmPayload {
  const theme: Record<string, string> = {};
  if (opts.accent !== null && HEX_RE.test(opts.accent)) theme.accent = opts.accent;
  const n = opts.totalPhotos;
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
    },
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
