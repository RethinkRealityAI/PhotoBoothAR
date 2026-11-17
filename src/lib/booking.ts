/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Booking links for the partnerships CRM — the pure half (no React, no
 * supabase import, so booking.test.ts runs in vitest's node env).
 *
 * A rep publishes weekly hours in THEIR timezone; a prospect opens
 * /book/<ref>, sees free slots in THEIR OWN timezone, and books one. The
 * server (migration 042, sales_book_meeting) re-validates every slot with the
 * SAME grid rule as generateSlots below — this list is a convenience, never
 * the gate. booking.test.ts pins the shared cases; change both or neither.
 *
 * Grid: for each window [ws, we) of a weekday (rep tz), starts are ws, ws+D,
 * ws+2D … while start + D <= we. A slot is free unless a confirmed booking b
 * has b.start < start + D + buffer AND b.end > start - buffer. Notice: start
 * >= now + minNoticeHours. Horizon: local date index i in [0, horizonDays).
 */
import { friendlyCrmError, type CrmErrorLike } from './crm';
import type { IcpId, Market } from './salesTypes';

// ── Types ──────────────────────────────────────────────────────────────────

export type Weekday = '0' | '1' | '2' | '3' | '4' | '5' | '6';
export const WEEKDAYS: readonly { id: Weekday; short: string; long: string }[] = [
  { id: '1', short: 'Mon', long: 'Monday' },
  { id: '2', short: 'Tue', long: 'Tuesday' },
  { id: '3', short: 'Wed', long: 'Wednesday' },
  { id: '4', short: 'Thu', long: 'Thursday' },
  { id: '5', short: 'Fri', long: 'Friday' },
  { id: '6', short: 'Sat', long: 'Saturday' },
  { id: '0', short: 'Sun', long: 'Sunday' },
];

/** 'HH:MM' pairs per weekday (0 = Sunday). Missing/empty = closed. */
export type WeeklyHours = Partial<Record<Weekday, Array<[string, string]>>>;

export const DURATIONS = [15, 20, 30, 45, 60] as const;
export type Duration = (typeof DURATIONS)[number];

/** A rep's own settings row (sales_booking_pages). */
export interface BookingSettings {
  user_id: string;
  enabled: boolean;
  headline: string | null;
  intro: string | null;
  duration_min: number;
  buffer_min: number;
  timezone: string;
  weekly: WeeklyHours;
  min_notice_hours: number;
  horizon_days: number;
  meeting_link: string | null;
  market: Market;
  updated_at?: string;
}

/** What sales_booking_page_public hands an anonymous visitor. */
export interface PublicBookingPage {
  ref: string;
  rep_name: string;
  headline: string | null;
  intro: string | null;
  duration_min: number;
  buffer_min: number;
  timezone: string;
  weekly: WeeklyHours;
  min_notice_hours: number;
  horizon_days: number;
  market: Market;
  /** Confirmed bookings as [startIso, endIso]. Times only, never who. */
  busy: Array<[string, string]>;
}

export type BookingStatus = 'confirmed' | 'completed' | 'no_show' | 'cancelled';

export interface Booking {
  id: string;
  rep_id: string;
  prospect_id: string | null;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  icp: IcpId | 'other';
  event_date: string | null;
  notes: string | null;
  booker_tz: string | null;
  created_at: string;
}

export interface BookingConfirmation {
  booking_id: string;
  starts_at: string;
  ends_at: string;
  duration_min: number;
  timezone: string;
  rep_name: string;
  meeting_link: string | null;
}

export const BOOKING_STATUSES: readonly { id: BookingStatus; label: string; pill: string }[] = [
  { id: 'confirmed', label: 'Booked', pill: 'bg-emerald-400/12 border-emerald-300/35 text-emerald-100' },
  { id: 'completed', label: 'Done', pill: 'bg-sky-400/10 border-sky-300/30 text-sky-100' },
  { id: 'no_show', label: 'No-show', pill: 'bg-amber-400/12 border-amber-300/35 text-amber-100' },
  { id: 'cancelled', label: 'Cancelled', pill: 'bg-white/[0.04] border-white/12 text-brand-muted' },
];

export function bookingStatusDef(s: BookingStatus) {
  return BOOKING_STATUSES.find((d) => d.id === s) ?? BOOKING_STATUSES[0];
}

/** "What are you planning?" on the public page → the CRM's ICP. */
export const BOOKER_ICPS: readonly { id: IcpId | 'other'; label: string }[] = [
  { id: 'planners', label: 'I plan weddings or events' },
  { id: 'brands', label: 'A brand or company event' },
  { id: 'creators', label: 'I’m a creator' },
  { id: 'other', label: 'Something else' },
];

/** Mon–Thu 10–17, Fri 10–15. Mirrors the 042 column default. */
export const DEFAULT_WEEKLY: WeeklyHours = {
  '1': [['10:00', '17:00']],
  '2': [['10:00', '17:00']],
  '3': [['10:00', '17:00']],
  '4': [['10:00', '17:00']],
  '5': [['10:00', '15:00']],
};

/** Timezones offered in the CRM picker (the rep's own is added if missing). */
export const TIMEZONE_OPTIONS: readonly { id: string; label: string }[] = [
  { id: 'Africa/Lagos', label: 'Lagos (WAT)' },
  { id: 'Europe/London', label: 'London' },
  { id: 'America/Toronto', label: 'Toronto (Eastern)' },
  { id: 'America/New_York', label: 'New York (Eastern)' },
  { id: 'America/Chicago', label: 'Chicago (Central)' },
  { id: 'America/Denver', label: 'Denver (Mountain)' },
  { id: 'America/Los_Angeles', label: 'Los Angeles (Pacific)' },
  { id: 'America/Vancouver', label: 'Vancouver (Pacific)' },
];

export const BOOKING_BASE = '/book';

// ── Time ───────────────────────────────────────────────────────────────────

/** 'HH:MM' → minutes since midnight; '24:00' allowed as an end. null if junk. */
export function parseHHMM(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (m === null) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h === 24 && mi === 0) return 1440;
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

export function formatHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function isValidTimeZone(tz: string): boolean {
  if (tz.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const partsFmt = new Map<string, Intl.DateTimeFormat>();
function fmtFor(tz: string): Intl.DateTimeFormat {
  let f = partsFmt.get(tz);
  if (f === undefined) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    partsFmt.set(tz, f);
  }
  return f;
}

export interface WallTime {
  y: number;
  /** 1-12 (NOT the JS 0-index). */
  mo: number;
  d: number;
  /** minutes since local midnight */
  minutes: number;
  seconds: number;
  /** 0 = Sunday, matching Postgres extract(dow) */
  dow: number;
}

/** The wall-clock reading of an instant in `tz`. */
export function wallTime(utcMs: number, tz: string): WallTime {
  const parts = fmtFor(tz).formatToParts(new Date(utcMs));
  const get = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const y = get('year');
  const mo = get('month');
  const d = get('day');
  // Some engines print midnight as "24" even with h23.
  const h = get('hour') % 24;
  const mi = get('minute');
  const s = get('second');
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return { y, mo, d, minutes: h * 60 + mi, seconds: s, dow };
}

/** tz offset in minutes (local − UTC) at an instant. Lagos → +60. */
export function tzOffsetMinutes(utcMs: number, tz: string): number {
  const w = wallTime(utcMs, tz);
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, 0, w.minutes, w.seconds);
  // ms → minutes; drop sub-second noise from utcMs.
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

/**
 * The instant at wall-clock (y-mo-d, minutes) in `tz`. Two passes so a date
 * near a DST change uses the offset in force AT that time, not "now".
 * Traces (TRAPS.md):
 *  - 2026-01-31 10:00 Africa/Lagos (+01:00, no DST) → 09:00Z
 *  - 2026-12-31 23:30 America/Toronto (−05:00) → 2027-01-01 04:30Z
 *  - 2026-03-08 10:00 America/Toronto (DST began 02:00 that day, −04:00) → 14:00Z
 * A wall time inside a spring-forward gap (02:30 that day) does not exist;
 * callers check wallTime(result) round-trips and skip it.
 */
export function zonedWallTimeToUtc(y: number, mo: number, d: number, minutes: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, 0, minutes);
  const off1 = tzOffsetMinutes(guess, tz);
  let t = guess - off1 * 60_000; // minutes → ms
  const off2 = tzOffsetMinutes(t, tz);
  if (off2 !== off1) t = guess - off2 * 60_000;
  return t;
}

// ── Hours validation (mirrors the 042 trigger) ────────────────────────────

/** null when valid, else a sentence. ≤3 windows a day, start < end. */
export function validateWeekly(weekly: WeeklyHours): string | null {
  let open = 0;
  for (const [k, wins] of Object.entries(weekly)) {
    if (!/^[0-6]$/.test(k) || !Array.isArray(wins)) return 'Those hours aren’t valid.';
    if (wins.length > 3) return 'Up to three time ranges a day.';
    for (const w of wins) {
      if (!Array.isArray(w) || w.length !== 2) return 'Those hours aren’t valid.';
      const s = parseHHMM(w[0]);
      const e = parseHHMM(w[1]);
      if (s === null || e === null || s === 1440) return 'Use times like 09:00.';
      if (s >= e) return 'Each range has to end after it starts.';
      open += 1;
    }
  }
  return open === 0 ? 'Open at least one day so people can book you.' : null;
}

/** Drop days with no windows so the stored jsonb stays tidy. */
export function compactWeekly(weekly: WeeklyHours): WeeklyHours {
  const out: WeeklyHours = {};
  for (const day of WEEKDAYS) {
    const w = weekly[day.id];
    if (w !== undefined && w.length > 0) out[day.id] = w.map(([s, e]) => [s, e]);
  }
  return out;
}

// ── Slots ──────────────────────────────────────────────────────────────────

export interface SlotRules {
  duration_min: number;
  buffer_min: number;
  timezone: string;
  weekly: WeeklyHours;
  min_notice_hours: number;
  horizon_days: number;
}

export interface Slot {
  startMs: number;
  endMs: number;
}

function parseBusy(busy: ReadonlyArray<readonly [string, string]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const b of busy) {
    const s = Date.parse(b[0]);
    const e = Date.parse(b[1]);
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) out.push([s, e]);
  }
  return out;
}

/** Every free slot, ascending. See the header for the grid rule. */
export function generateSlots(
  rules: SlotRules,
  busy: ReadonlyArray<readonly [string, string]>,
  now: Date,
): Slot[] {
  const D = rules.duration_min;
  if (!Number.isFinite(D) || D <= 0 || !isValidTimeZone(rules.timezone)) return [];
  const bufMs = Math.max(0, rules.buffer_min) * 60_000; // minutes → ms
  const durMs = D * 60_000; // minutes → ms
  const earliest = now.getTime() + Math.max(0, rules.min_notice_hours) * 3_600_000; // hours → ms
  const taken = parseBusy(busy);
  const today = wallTime(now.getTime(), rules.timezone);
  const out: Slot[] = [];
  // i in [0, horizon): horizon=0 → no days; 1 → today only.
  for (let i = 0; i < rules.horizon_days; i += 1) {
    // Calendar-day stepping on the date alone (never +24h: DST).
    const day = new Date(Date.UTC(today.y, today.mo - 1, today.d + i));
    const y = day.getUTCFullYear();
    const mo = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    const wins = rules.weekly[String(day.getUTCDay()) as Weekday] ?? [];
    for (const [sStr, eStr] of wins) {
      const ws = parseHHMM(sStr);
      const we = parseHHMM(eStr);
      if (ws === null || we === null || ws >= we) continue;
      for (let t = ws; t + D <= we; t += D) {
        const start = zonedWallTimeToUtc(y, mo, d, t, rules.timezone);
        const back = wallTime(start, rules.timezone);
        if (back.minutes !== t || back.d !== d) continue; // DST gap: wall time doesn't exist
        if (start < earliest) continue;
        const end = start + durMs;
        const clash = taken.some(([bs, be]) => bs < end + bufMs && be > start - bufMs);
        if (!clash) out.push({ startMs: start, endMs: end });
      }
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

export interface SlotDay {
  /** 'YYYY-MM-DD' in the VIEWER's timezone. */
  key: string;
  weekday: string;
  label: string;
  slots: Slot[];
}

/** Group slots by the viewer's local calendar day, for the day picker. */
export function groupSlotsByDay(slots: readonly Slot[], viewerTz: string): SlotDay[] {
  const tz = isValidTimeZone(viewerTz) ? viewerTz : 'UTC';
  const weekdayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' });
  const labelFmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short' });
  const days: SlotDay[] = [];
  for (const s of slots) {
    const w = wallTime(s.startMs, tz);
    const key = `${w.y}-${String(w.mo).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
    let day = days[days.length - 1];
    if (day === undefined || day.key !== key) {
      const at = new Date(s.startMs);
      day = { key, weekday: weekdayFmt.format(at), label: labelFmt.format(at), slots: [] };
      days.push(day);
    }
    day.slots.push(s);
  }
  return days;
}

export function formatSlotTime(ms: number, tz: string): string {
  // en-GB + hour12 → "10:00 am", matching formatSlotLong's casing.
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: isValidTimeZone(tz) ? tz : 'UTC', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(ms));
}

export function formatSlotLong(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: isValidTimeZone(tz) ? tz : 'UTC',
    weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(ms));
}

/** "Lagos" / "Toronto" — the city part of an IANA name. */
export function tzCity(tz: string): string {
  const known = TIMEZONE_OPTIONS.find((o) => o.id === tz);
  if (known !== undefined) return known.label.replace(/\s*\(.*\)$/, '');
  const tail = tz.split('/').pop() ?? tz;
  return tail.replace(/_/g, ' ');
}

// ── Links ──────────────────────────────────────────────────────────────────

/** Absolute public booking URL for a ref code, or null without one. */
export function bookingUrl(origin: string, ref: string | null | undefined): string | null {
  const code = (ref ?? '').trim().toLowerCase();
  if (!/^[a-z0-9-]{2,24}$/.test(code)) return null;
  try {
    return new URL(`${BOOKING_BASE}/${code}`, origin).toString();
  } catch {
    return null;
  }
}

/** Same-origin path, for in-app links. */
export function bookingPath(ref: string): string {
  return `${BOOKING_BASE}/${ref.trim().toLowerCase()}`;
}

// ── Booker form ────────────────────────────────────────────────────────────

export interface BookerDraft {
  name: string;
  email: string;
  phone: string;
  company: string;
  /** null until the visitor picks one (no silent default into the CRM). */
  icp: IcpId | 'other' | null;
  eventDate: string;
  notes: string;
  consent: boolean;
}

export const EMPTY_BOOKER: BookerDraft = {
  name: '', email: '', phone: '', company: '', icp: null, eventDate: '', notes: '', consent: false,
};

export type BookerErrors = Partial<Record<'name' | 'contact' | 'email' | 'phone' | 'eventDate' | 'notes' | 'consent', string>>;

/** Mirrors the 042 RPC's shape checks so most mistakes never round-trip. */
export function validateBooker(d: BookerDraft): BookerErrors {
  const e: BookerErrors = {};
  const name = d.name.trim();
  if (name === '') e.name = 'Tell us your name.';
  else if (name.length > 200) e.name = 'That name is too long.';
  const email = d.email.trim();
  const phone = d.phone.trim();
  if (email === '' && phone === '') e.contact = 'Add an email or a WhatsApp number so we can reach you.';
  if (email !== '' && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) e.email = 'That email doesn’t look right.';
  if (phone !== '' && !/^[+0-9 ()\-.]{6,40}$/.test(phone)) e.phone = 'Use digits, spaces and a + for the country code.';
  if (d.eventDate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(d.eventDate)) e.eventDate = 'Pick a date.';
  if (d.notes.length > 1000) e.notes = 'Keep it under 1,000 characters.';
  if (!d.consent) e.consent = 'Tick this so we can contact you about the call.';
  return e;
}

export function hasErrors(e: BookerErrors): boolean {
  return Object.values(e).some((v) => v !== undefined);
}

/** Server/network error → a sentence for the booker or the rep. */
export function friendlyBookingError(err: CrmErrorLike | null | undefined): string {
  const msg = err?.message ?? '';
  const table: Array<[string, string]> = [
    ['slot_taken', 'Someone just booked that time. Pick another one.'],
    ['slot_unavailable', 'That time isn’t available any more. Pick another one.'],
    ['booking_page_not_found', 'This booking link isn’t active right now.'],
    ['too_many_bookings', 'You already have calls booked. Reply to your confirmation if you need to change one.'],
    ['consent_required', 'Tick the consent box to book.'],
    ['contact_required', 'Add an email or a WhatsApp number so we can reach you.'],
    ['invalid_email', 'That email doesn’t look right.'],
    ['invalid_phone', 'That phone number doesn’t look right.'],
    ['invalid_name', 'Tell us your name.'],
    ['invalid_event_date', 'That event date doesn’t look right.'],
    ['too_long', 'Something in the form is too long.'],
    ['invalid_hours', 'Those hours aren’t valid.'],
    ['invalid_timezone', 'Pick a timezone from the list.'],
    ['ref_code_locked', 'Your link is already live. Ask Dapo if it needs to change.'],
    ['ref_code_taken', 'Someone already has that link. Try another.'],
    ['invalid_ref_code', 'Use 2–24 lowercase letters, numbers or dashes.'],
  ];
  for (const [code, sentence] of table) if (msg.includes(code)) return sentence;
  return friendlyCrmError(err);
}

// ── Calendar ───────────────────────────────────────────────────────────────

function icsStamp(ms: number): string {
  // 2026-11-20T09:00:00.000Z → 20261120T090000Z
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

export interface CalendarEvent {
  uid: string;
  startMs: number;
  endMs: number;
  title: string;
  description: string;
  location: string | null;
}

export function buildIcs(ev: CalendarEvent, nowMs: number = Date.now()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Beamwall//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ev.uid}@beamwall`,
    `DTSTAMP:${icsStamp(nowMs)}`,
    `DTSTART:${icsStamp(ev.startMs)}`,
    `DTEND:${icsStamp(ev.endMs)}`,
    `SUMMARY:${icsEscape(ev.title)}`,
    `DESCRIPTION:${icsEscape(ev.description)}`,
    ...(ev.location !== null && ev.location !== '' ? [`LOCATION:${icsEscape(ev.location)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

export function googleCalendarUrl(ev: CalendarEvent): string {
  const u = new URL('https://calendar.google.com/calendar/render');
  u.searchParams.set('action', 'TEMPLATE');
  u.searchParams.set('text', ev.title);
  u.searchParams.set('dates', `${icsStamp(ev.startMs)}/${icsStamp(ev.endMs)}`);
  u.searchParams.set('details', ev.description);
  if (ev.location !== null && ev.location !== '') u.searchParams.set('location', ev.location);
  return u.toString();
}

// ── CRM side ───────────────────────────────────────────────────────────────

/** Upcoming confirmed first (soonest first), then the rest newest first. */
export function sortBookings(list: readonly Booking[], now: Date): Booking[] {
  const t = now.getTime();
  const upcoming = list
    .filter((b) => b.status === 'confirmed' && Date.parse(b.ends_at) >= t)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const rest = list
    .filter((b) => !(b.status === 'confirmed' && Date.parse(b.ends_at) >= t))
    .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
  return [...upcoming, ...rest];
}

export function upcomingCount(list: readonly Booking[], now: Date): number {
  const t = now.getTime();
  return list.filter((b) => b.status === 'confirmed' && Date.parse(b.ends_at) >= t).length;
}

/** Coerce a settings row from PostgREST into a total object. */
export function normalizeSettings(row: Record<string, unknown>): BookingSettings {
  const r = row as unknown as BookingSettings;
  const weekly = r.weekly !== null && typeof r.weekly === 'object' && !Array.isArray(r.weekly) ? r.weekly : {};
  return { ...r, weekly };
}

/** A fresh settings draft for a rep who has never opened the panel. */
export function defaultSettings(userId: string, market: Market, browserTz: string): BookingSettings {
  const tz = market === 'ng' ? 'Africa/Lagos' : isValidTimeZone(browserTz) ? browserTz : 'America/Toronto';
  return {
    user_id: userId,
    enabled: true,
    headline: null,
    intro: null,
    duration_min: 30,
    buffer_min: 10,
    timezone: tz,
    weekly: DEFAULT_WEEKLY,
    min_notice_hours: 12,
    horizon_days: 21,
    meeting_link: null,
    market,
  };
}
