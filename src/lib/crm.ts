/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure model for the partnerships CRM (src/pages/sales/crm). The contract is
 * supabase/migrations/041_sales_crm.sql — every length cap and enum here
 * mirrors a CHECK there, so a draft that passes `validateProspectDraft` is one
 * Postgres will accept.
 *
 * No React, no supabase import: crm.test.ts runs in vitest's node env and must
 * never reach src/lib/supabase.ts. The I/O half lives in crmApi.ts.
 *
 * Two traps this file exists to keep out of the UI:
 *  - DATES. `next_follow_up` is a Postgres DATE, i.e. the string 'YYYY-MM-DD'.
 *    `new Date('2026-11-17')` parses that as UTC midnight, which in Toronto is
 *    the evening of the 16th — so a follow-up would read "overdue" a day early.
 *    Everything here compares LOCAL calendar-day keys built from date parts.
 *  - MONEY. Deal values are whole cents (int). "1500.50" is parsed by string
 *    splitting, never by parseFloat * 100 (0.29 * 100 = 28.999999999999996).
 */
import {
  COLLATERAL, MARKETS, type CollateralItem, type IcpId, type Market, type MessageTemplate, type TemplateToken,
} from './salesTypes';

// ── Status ─────────────────────────────────────────────────────────────────

export type ProspectStatus =
  | 'new' | 'contacted' | 'replied' | 'meeting' | 'proposal' | 'won' | 'lost' | 'nurture';

export interface StatusDef {
  id: ProspectStatus;
  label: string;
  /** Pill classes (bg + border + text). Dark surfaces only. */
  pill: string;
  /** Solid dot / bar colour. */
  dot: string;
}

/** Pipeline order. `won`/`lost`/`nurture` are exits, not steps. */
export const PROSPECT_STATUSES: readonly StatusDef[] = [
  { id: 'new', label: 'New', pill: 'bg-white/[0.06] border-white/15 text-brand-fg/80', dot: 'bg-white/60' },
  { id: 'contacted', label: 'Contacted', pill: 'bg-sky-400/10 border-sky-300/30 text-sky-200', dot: 'bg-sky-300' },
  { id: 'replied', label: 'Replied', pill: 'bg-cyan-400/10 border-cyan-300/30 text-cyan-200', dot: 'bg-cyan-300' },
  { id: 'meeting', label: 'Meeting', pill: 'bg-violet-400/10 border-violet-300/30 text-violet-200', dot: 'bg-violet-300' },
  { id: 'proposal', label: 'Proposal', pill: 'bg-amber-400/10 border-amber-300/30 text-amber-200', dot: 'bg-amber-300' },
  { id: 'won', label: 'Won', pill: 'bg-emerald-400/10 border-emerald-300/35 text-emerald-200', dot: 'bg-emerald-300' },
  { id: 'lost', label: 'Lost', pill: 'bg-rose-400/10 border-rose-300/25 text-rose-200/80', dot: 'bg-rose-300/70' },
  { id: 'nurture', label: 'Nurture', pill: 'bg-white/[0.04] border-white/10 text-brand-muted', dot: 'bg-white/35' },
];

/** The linear steps shown in the stepper. */
export const PIPELINE_STEPS: readonly ProspectStatus[] = ['new', 'contacted', 'replied', 'meeting', 'proposal', 'won'];
/** Statuses that are finished — no follow-up nagging, not "open pipeline". */
export const CLOSED_STATUSES: readonly ProspectStatus[] = ['won', 'lost'];

export function isProspectStatus(v: unknown): v is ProspectStatus {
  return typeof v === 'string' && PROSPECT_STATUSES.some((s) => s.id === v);
}

export function statusDef(id: string): StatusDef {
  return PROSPECT_STATUSES.find((s) => s.id === id) ?? PROSPECT_STATUSES[0];
}

export function isOpenStatus(s: ProspectStatus): boolean {
  return !CLOSED_STATUSES.includes(s);
}

// ── ICP ────────────────────────────────────────────────────────────────────

/** The table also allows 'other' (041 CHECK) — salesTypes' IcpId does not. */
export type CrmIcp = IcpId | 'other';

export const CRM_ICPS: readonly { id: CrmIcp; label: string; pill: string }[] = [
  { id: 'planners', label: 'Planner', pill: 'bg-[color:var(--color-accent)]/12 border-[color:var(--color-accent)]/35 text-brand-fg' },
  { id: 'brands', label: 'Brand', pill: 'bg-fuchsia-400/10 border-fuchsia-300/30 text-fuchsia-200' },
  { id: 'creators', label: 'Creator', pill: 'bg-teal-400/10 border-teal-300/30 text-teal-200' },
  { id: 'other', label: 'Other', pill: 'bg-white/[0.05] border-white/12 text-brand-muted' },
];

export function isCrmIcp(v: unknown): v is CrmIcp {
  return typeof v === 'string' && CRM_ICPS.some((i) => i.id === v);
}

export function icpDef(id: string) {
  return CRM_ICPS.find((i) => i.id === id) ?? CRM_ICPS[CRM_ICPS.length - 1];
}

// ── Market ─────────────────────────────────────────────────────────────────

/** New prospects default to Nigeria — James's primary market (041 default). */
export const DEFAULT_MARKET: Market = 'ng';

export function isMarket(v: unknown): v is Market {
  return typeof v === 'string' && MARKETS.some((m) => m.id === v);
}

export function marketDef(id: string) {
  return MARKETS.find((m) => m.id === id) ?? MARKETS[0];
}

// ── Socials ────────────────────────────────────────────────────────────────

export const SOCIAL_KEYS = ['instagram', 'linkedin', 'tiktok', 'facebook', 'youtube', 'x'] as const;
export type SocialKey = (typeof SOCIAL_KEYS)[number];
export type Socials = Partial<Record<SocialKey, string>>;

export const SOCIAL_LABELS: Record<SocialKey, string> = {
  instagram: 'Instagram', linkedin: 'LinkedIn', tiktok: 'TikTok',
  facebook: 'Facebook', youtube: 'YouTube', x: 'X',
};

/** The platform's own domains — a bare "instagram.com/jane" is a URL, a bare
 *  "jane.doe" in the Instagram field is a handle. */
const SOCIAL_DOMAINS: Record<SocialKey, readonly string[]> = {
  instagram: ['instagram.com', 'instagr.am'],
  linkedin: ['linkedin.com', 'lnkd.in'],
  tiktok: ['tiktok.com'],
  facebook: ['facebook.com', 'fb.com', 'fb.me'],
  youtube: ['youtube.com', 'youtu.be'],
  x: ['x.com', 'twitter.com'],
};

function profileUrl(kind: SocialKey, handle: string): string {
  switch (kind) {
    case 'instagram': return `https://www.instagram.com/${handle}/`;
    case 'tiktok': return `https://www.tiktok.com/@${handle}`;
    case 'x': return `https://x.com/${handle}`;
    case 'youtube': return `https://www.youtube.com/@${handle}`;
    case 'linkedin': return `https://www.linkedin.com/in/${handle}`;
    case 'facebook': return `https://www.facebook.com/${handle}`;
  }
}

const HANDLE_RE = /^[A-Za-z0-9._-]{1,100}$/;
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;

/**
 * Turn what someone typed into a safe https URL, or null.
 *  - '' / whitespace → null
 *  - '@jane' (or a bare 'jane' / 'jane.doe' in a social field) → that
 *    platform's profile URL
 *  - 'example.com', 'www.example.com/x' → 'https://…'
 *  - 'http://…' → upgraded to https
 *  - any other scheme (javascript:, data:, mailto:, ftp:) → null
 *  - no real host ('http://', 'https://localhost', 'foo') → null
 */
export function normalizeUrl(input: string | null | undefined, kind?: SocialKey): string | null {
  const raw = (input ?? '').trim();
  if (raw === '') return null;
  if (/\s/.test(raw)) return null;

  if (kind !== undefined) {
    const lower = raw.toLowerCase();
    const looksLikeUrl = raw.includes('/') || SCHEME_RE.test(raw)
      || SOCIAL_DOMAINS[kind].some((d) => lower === d || lower.endsWith(`.${d}`));
    if (!looksLikeUrl) {
      const handle = raw.startsWith('@') ? raw.slice(1) : raw;
      return HANDLE_RE.test(handle) ? profileUrl(kind, handle) : null;
    }
  }

  let candidate = raw;
  const scheme = SCHEME_RE.exec(raw);
  if (scheme !== null) {
    const s = scheme[1].toLowerCase();
    if (s !== 'http' && s !== 'https') return null;
    // 'https:example.com' parses in WHATWG URL; require the authority marker.
    if (raw.slice(scheme[0].length, scheme[0].length + 2) !== '//') return null;
    candidate = `https:${raw.slice(scheme[0].length)}`;
  } else {
    if (raw.startsWith('//')) candidate = `https:${raw}`;
    else candidate = `https://${raw}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  const host = url.hostname;
  // A real public host has a dot and a non-numeric-only TLD of 2+ letters.
  const tld = host.split('.').pop() ?? '';
  if (!host.includes('.') || !/^[a-z][a-z0-9-]*[a-z0-9]$/i.test(tld)) return null;
  const href = url.href;
  return href.length <= LIMITS.website ? href : null;
}

/** Short display form of a URL: host + path, no scheme, no trailing slash. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
}

// ── Rows ───────────────────────────────────────────────────────────────────

/** A sales_prospects row, as PostgREST returns it. */
export interface Prospect {
  id: string;
  owner_id: string | null;
  name: string;
  company: string | null;
  role: string | null;
  icp: CrmIcp;
  market: Market;
  email: string | null;
  phone: string | null;
  website: string | null;
  location: string | null;
  socials: Socials;
  source: string | null;
  status: ProspectStatus;
  /** Minor units of the MARKET's currency: USD cents for 'na', kobo for 'ng'. */
  deal_value_cents: number | null;
  /** Postgres DATE: 'YYYY-MM-DD', a LOCAL calendar day. */
  next_follow_up: string | null;
  last_contacted_at: string | null;
  notes: string | null;
  /** { collateralId: ISO timestamp sent } */
  collateral: Record<string, string>;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export type ActivityKind = 'dm' | 'email' | 'call' | 'meeting' | 'note' | 'status';
/** Kinds that count as an outreach touch (the daily counter + last_contacted_at). */
export const TOUCH_KINDS: readonly ActivityKind[] = ['dm', 'email', 'call', 'meeting'];

export function isTouchKind(kind: ActivityKind): boolean {
  return TOUCH_KINDS.includes(kind);
}

/** A sales_activities row. */
export interface Activity {
  id: string;
  prospect_id: string;
  actor_id: string | null;
  kind: ActivityKind;
  channel: string | null;
  body: string | null;
  created_at: string;
}

/** A sales_team_list() row. */
export interface TeamMember {
  user_id: string;
  email: string;
  display_name: string | null;
  role: 'rep' | 'manager';
  ref_code: string | null;
  created_at: string;
}

export function memberName(m: Pick<TeamMember, 'display_name' | 'email'>): string {
  const n = (m.display_name ?? '').trim();
  if (n !== '') return n;
  return m.email.split('@')[0] ?? m.email;
}

/** Outreach touches per working day. The playbook's DAILY_TARGETS may differ. */
export const DAILY_TOUCH_TARGET = 20;

/** Mirrors the CHECK constraints in 041. */
export const LIMITS = {
  name: 200, company: 200, role: 120, email: 254, phone: 40, website: 500,
  location: 120, source: 120, notes: 20000, social: 500, activityBody: 4000, channel: 40,
} as const;

/** int4 max — deal_value_cents is `int`. */
export const MAX_DEAL_CENTS = 2147483647;

// ── Money ──────────────────────────────────────────────────────────────────

export type CentsParse = { ok: true; cents: number | null } | { ok: false };

/**
 * '1,500' → 150000 · '1500.5' → 150050 · '$99' → 9900 · '' → null (ok).
 * Rejects negatives, 3+ decimals, bad comma grouping, and values past int4.
 */
export function parseDollarsToCents(input: string | null | undefined): CentsParse {
  let s = (input ?? '').trim();
  if (s === '') return { ok: true, cents: null };
  s = s.replace(/^(?:\$|₦|NGN|USD|N)\s*/i, '').replace(/\s+/g, '');
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d{0,2}))?$/.exec(s);
  if (m === null || (m[1] === undefined && (m[2] ?? '') === '')) return { ok: false };
  const whole = (m[1] ?? '0').replace(/,/g, '');
  const frac = (m[2] ?? '').padEnd(2, '0');
  if (whole.length > 9) return { ok: false };
  const cents = Number(whole) * 100 + Number(frac);
  if (!Number.isSafeInteger(cents) || cents > MAX_DEAL_CENTS) return { ok: false };
  return { ok: true, cents };
}

/**
 * 150000 → '$1,500' · 150050 → '$1,500.50' · 0 → '$0'; market 'ng' → '₦'.
 * Grouping pinned to en-US (an unpinned Intl renders 'US$' on en-CA).
 */
export function formatCents(cents: number, market: Market = 'na'): string {
  const symbol = marketDef(market).symbol;
  const c = Math.max(0, Math.trunc(cents));
  const dollars = Math.floor(c / 100);
  const rem = c % 100;
  const head = `${symbol}${dollars.toLocaleString('en-US')}`;
  return rem === 0 ? head : `${head}.${String(rem).padStart(2, '0')}`;
}

/** Compact: 150000 → '$1.5k', 125000000 → '$1.25M'. For chips. */
export function formatCentsCompact(cents: number, market: Market = 'na'): string {
  const symbol = marketDef(market).symbol;
  const dollars = Math.max(0, Math.trunc(cents)) / 100;
  if (dollars < 1000) return formatCents(cents, market);
  if (dollars < 1_000_000) return `${symbol}${trimZeros((dollars / 1000).toFixed(1))}k`;
  return `${symbol}${trimZeros((dollars / 1_000_000).toFixed(2))}M`;
}
function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Inverse for an edit form: 150050 → '1500.50', 150000 → '1500', null → ''. */
export function centsToInput(cents: number | null): string {
  if (cents === null) return '';
  const dollars = Math.floor(cents / 100);
  const rem = cents % 100;
  return rem === 0 ? String(dollars) : `${dollars}.${String(rem).padStart(2, '0')}`;
}

// ── Dates (local calendar days) ────────────────────────────────────────────

/** Local 'YYYY-MM-DD' for an instant. */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Strict 'YYYY-MM-DD' → [y, m, d], or null for anything else (incl. 2026-02-30). */
export function parseDateKey(key: string | null | undefined): [number, number, number] | null {
  if (typeof key !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (m === null) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return [y, mo, d];
}

/**
 * Calendar arithmetic on a key. Done in UTC on the PARTS — a calendar day has
 * no time zone, so no DST edge can shift it.
 * Traces: 2026-01-31 +1 → 2026-02-01 · 2026-12-31 +1 → 2027-01-01 ·
 * 2026-03-08 (US DST) +1 → 2026-03-09 · 2028-02-28 +1 → 2028-02-29.
 */
export function addDaysToKey(key: string, days: number): string {
  const p = parseDateKey(key);
  if (p === null) return key;
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Whole calendar days from `a` to `b` (b − a). Null if either is invalid. */
export function daysBetweenKeys(a: string, b: string): number | null {
  const pa = parseDateKey(a); const pb = parseDateKey(b);
  if (pa === null || pb === null) return null;
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86_400_000);
}

/** 'Tue, Nov 17' for a DATE key, built from parts (never `new Date(key)`). */
export function formatDateKey(key: string): string {
  const p = parseDateKey(key);
  if (p === null) return key;
  const d = new Date(p[0], p[1] - 1, p[2]);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export type FollowUpState = 'overdue' | 'today' | 'soon' | 'none';
/** "Soon" = within this many days after today. */
export const FOLLOW_UP_SOON_DAYS = 3;

export function followUpState(
  prospect: Pick<Prospect, 'next_follow_up' | 'status'>,
  today: Date,
): FollowUpState {
  if (prospect.next_follow_up === null || !isOpenStatus(prospect.status)) return 'none';
  const diff = daysBetweenKeys(localDateKey(today), prospect.next_follow_up);
  if (diff === null) return 'none';
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff <= FOLLOW_UP_SOON_DAYS) return 'soon';
  return 'none';
}

/** 'Overdue 2d' · 'Due today' · 'Tomorrow' · 'In 3 days' · 'Thu, Nov 26'. */
export function followUpLabel(key: string, today: Date): string {
  const diff = daysBetweenKeys(localDateKey(today), key);
  if (diff === null) return key;
  if (diff < 0) return diff === -1 ? 'Overdue 1 day' : `Overdue ${-diff} days`;
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Tomorrow';
  if (diff <= 6) return `In ${diff} days`;
  return formatDateKey(key);
}

/** 'Sent today' · 'Sent yesterday' · 'Sent 3 days ago' — by LOCAL day. */
export function sentAgo(iso: string, now: Date): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return 'Sent';
  const diff = daysBetweenKeys(localDateKey(t), localDateKey(now)) ?? 0;
  if (diff <= 0) return 'Sent today';
  if (diff === 1) return 'Sent yesterday';
  return `Sent ${diff} days ago`;
}

/** Relative-ish timestamp for the timeline: '3:42 PM' today, 'Yesterday', 'Nov 3'. */
export function activityWhen(iso: string, now: Date): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const diff = daysBetweenKeys(localDateKey(t), localDateKey(now)) ?? 0;
  if (diff <= 0) return t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (diff === 1) return 'Yesterday';
  const sameYear = t.getFullYear() === now.getFullYear();
  return t.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Draft → payload ────────────────────────────────────────────────────────

/** What the forms hold: every field a string, exactly as typed. */
export interface ProspectDraft {
  name: string;
  company?: string;
  role?: string;
  icp?: string;
  /** 'ng' | 'na'; absent/'' → DEFAULT_MARKET. */
  market?: string;
  email?: string;
  phone?: string;
  website?: string;
  location?: string;
  source?: string;
  status?: string;
  /** Dollars, as typed: '1,500', '1500.50', '$99'. */
  dealValue?: string;
  /** 'YYYY-MM-DD' or ''. */
  nextFollowUp?: string;
  notes?: string;
  socials?: Partial<Record<SocialKey, string>>;
}

export type DraftField = keyof Omit<ProspectDraft, 'socials'> | `socials.${SocialKey}`;

export interface DraftValidation {
  ok: boolean;
  errors: Partial<Record<DraftField, string>>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function tooLong(v: string | undefined, max: number): boolean {
  return (v ?? '').trim().length > max;
}

export function validateProspectDraft(draft: ProspectDraft): DraftValidation {
  const errors: DraftValidation['errors'] = {};
  const name = (draft.name ?? '').trim();
  if (name === '') errors.name = 'Add a name — first name is fine.';
  else if (name.length > LIMITS.name) errors.name = `Keep the name under ${LIMITS.name} characters.`;

  const capped: Array<[Exclude<DraftField, 'name' | `socials.${SocialKey}`>, number]> = [
    ['company', LIMITS.company], ['role', LIMITS.role], ['phone', LIMITS.phone],
    ['location', LIMITS.location], ['source', LIMITS.source], ['notes', LIMITS.notes],
  ];
  for (const [field, max] of capped) {
    if (tooLong(draft[field], max)) errors[field] = `Keep this under ${max.toLocaleString('en-US')} characters.`;
  }

  const email = (draft.email ?? '').trim();
  if (email !== '') {
    if (email.length > LIMITS.email) errors.email = 'That email is too long.';
    else if (!EMAIL_RE.test(email)) errors.email = 'That doesn’t look like an email address.';
  }

  const website = (draft.website ?? '').trim();
  if (website !== '' && normalizeUrl(website) === null) {
    errors.website = 'Use a web address like example.com.';
  }

  for (const key of SOCIAL_KEYS) {
    const v = (draft.socials?.[key] ?? '').trim();
    if (v !== '' && normalizeUrl(v, key) === null) {
      errors[`socials.${key}`] = `Use @handle or a ${SOCIAL_LABELS[key]} link.`;
    }
  }

  if (draft.icp !== undefined && draft.icp !== '' && !isCrmIcp(draft.icp)) errors.icp = 'Pick a type.';
  if (draft.market !== undefined && draft.market !== '' && !isMarket(draft.market)) errors.market = 'Pick a market.';
  if (draft.status !== undefined && draft.status !== '' && !isProspectStatus(draft.status)) errors.status = 'Pick a status.';

  if (!parseDollarsToCents(draft.dealValue).ok) {
    errors.dealValue = 'Use a dollar amount like 1,500 or 1500.50.';
  }

  const fu = (draft.nextFollowUp ?? '').trim();
  if (fu !== '' && parseDateKey(fu) === null) errors.nextFollowUp = 'Pick a real date.';

  return { ok: Object.keys(errors).length === 0, errors };
}

/** Columns a client may write. owner_id is omitted: the DB defaults it to auth.uid(). */
export interface ProspectWrite {
  name: string;
  company: string | null;
  role: string | null;
  icp: CrmIcp;
  market: Market;
  email: string | null;
  phone: string | null;
  website: string | null;
  location: string | null;
  source: string | null;
  status: ProspectStatus;
  deal_value_cents: number | null;
  next_follow_up: string | null;
  notes: string | null;
  socials: Socials;
}

function clean(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
}

/**
 * Trim, '' → null, normalize URLs, dollars → cents. Total: a value that would
 * not validate is dropped to null (or the default) rather than sent — call
 * `validateProspectDraft` first to tell the user why.
 */
export function toInsertPayload(draft: ProspectDraft): ProspectWrite {
  const socials: Socials = {};
  for (const key of SOCIAL_KEYS) {
    const url = normalizeUrl(draft.socials?.[key], key);
    if (url !== null) socials[key] = url;
  }
  const money = parseDollarsToCents(draft.dealValue);
  const email = clean(draft.email);
  const fu = clean(draft.nextFollowUp);
  return {
    name: (draft.name ?? '').trim().slice(0, LIMITS.name),
    company: clean(draft.company),
    role: clean(draft.role),
    icp: isCrmIcp(draft.icp) ? draft.icp : 'planners',
    market: isMarket(draft.market) ? draft.market : DEFAULT_MARKET,
    email: email !== null && EMAIL_RE.test(email) && email.length <= LIMITS.email ? email : null,
    phone: clean(draft.phone),
    website: normalizeUrl(draft.website),
    location: clean(draft.location),
    source: clean(draft.source),
    status: isProspectStatus(draft.status) ? draft.status : 'new',
    deal_value_cents: money.ok ? money.cents : null,
    next_follow_up: fu !== null && parseDateKey(fu) !== null ? fu : null,
    notes: clean(draft.notes),
    socials,
  };
}

/** Row → editable draft (the inverse of toInsertPayload, for the edit form). */
export function draftFromProspect(p: Prospect): Required<Omit<ProspectDraft, 'socials'>> & { socials: Record<SocialKey, string> } {
  const socials = {} as Record<SocialKey, string>;
  for (const key of SOCIAL_KEYS) socials[key] = p.socials?.[key] ?? '';
  return {
    name: p.name,
    company: p.company ?? '',
    role: p.role ?? '',
    icp: p.icp,
    market: p.market,
    email: p.email ?? '',
    phone: p.phone ?? '',
    website: p.website ?? '',
    location: p.location ?? '',
    source: p.source ?? '',
    status: p.status,
    dealValue: centsToInput(p.deal_value_cents),
    nextFollowUp: p.next_follow_up ?? '',
    notes: p.notes ?? '',
    socials,
  };
}

/**
 * Quick-add's single "handle or email" box → the right draft field.
 * 'jane@x.co' → email · '0803 123 4567' / '+1 416…' → phone (WhatsApp is the
 * Nigerian default channel, so a number is the commonest handle there) ·
 * '@jane' / 'jane' / 'jane.doe' → socials[channel] (a channel chip is
 * selected, so a bare word IS a handle) · a link to that platform →
 * socials[channel] · any other link → website.
 * Unparseable input still lands in socials[channel] so validation can say why
 * instead of the text silently vanishing.
 */
export function quickContactToDraft(contact: string, channel: SocialKey): Pick<ProspectDraft, 'email' | 'phone' | 'website' | 'socials'> {
  const v = contact.trim();
  if (v === '') return {};
  if (!v.startsWith('@') && EMAIL_RE.test(v)) return { email: v };
  if (/^\+?[\d\s().-]{7,}$/.test(v) && v.replace(/\D/g, '').length >= 7) return { phone: v };
  const isLink = v.includes('/') || SCHEME_RE.test(v);
  if (!isLink) return { socials: { [channel]: v } };
  const lower = v.toLowerCase();
  const isPlatformLink = SOCIAL_DOMAINS[channel].some((d) => lower.includes(d));
  if (isPlatformLink) return { socials: { [channel]: v } };
  if (normalizeUrl(v) !== null) return { website: v };
  return { socials: { [channel]: v } };
}

// ── Lists ──────────────────────────────────────────────────────────────────

export interface ProspectFilters {
  query?: string;
  /** A status, 'open' (not won/lost), or null/undefined for all. */
  status?: ProspectStatus | 'open' | null;
  icp?: CrmIcp | null;
  market?: Market | null;
  owner?: string | null;
  /** 'due' = overdue or today. */
  due?: 'due' | 'overdue' | 'soon' | null;
}

function haystack(p: Prospect): string {
  return [
    p.name, p.company, p.role, p.email, p.phone, p.location, p.source, p.notes, p.website,
    ...Object.values(p.socials ?? {}),
  ].filter((v): v is string => typeof v === 'string').join(' ').toLowerCase();
}

export function filterProspects(list: readonly Prospect[], f: ProspectFilters, today: Date = new Date()): Prospect[] {
  const words = (f.query ?? '').toLowerCase().split(/\s+/).filter((w) => w !== '');
  return list.filter((p) => {
    if (f.status === 'open') { if (!isOpenStatus(p.status)) return false; }
    else if (f.status !== undefined && f.status !== null && p.status !== f.status) return false;
    if (f.icp !== undefined && f.icp !== null && p.icp !== f.icp) return false;
    if (f.market !== undefined && f.market !== null && p.market !== f.market) return false;
    if (f.owner !== undefined && f.owner !== null && p.owner_id !== f.owner) return false;
    if (f.due !== undefined && f.due !== null) {
      const s = followUpState(p, today);
      if (f.due === 'due' && s !== 'overdue' && s !== 'today') return false;
      if (f.due === 'overdue' && s !== 'overdue') return false;
      if (f.due === 'soon' && s !== 'soon') return false;
    }
    if (words.length > 0) {
      const hay = haystack(p);
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

const FOLLOW_RANK: Record<FollowUpState, number> = { overdue: 0, today: 1, soon: 2, none: 3 };

/** Worklist order: overdue → today → soon → the rest; closed deals last;
 *  ties by follow-up date, then most recently touched/updated. Copies. */
export function sortForWorklist(list: readonly Prospect[], today: Date = new Date()): Prospect[] {
  return [...list].sort((a, b) => {
    const ca = isOpenStatus(a.status) ? 0 : 1;
    const cb = isOpenStatus(b.status) ? 0 : 1;
    if (ca !== cb) return ca - cb;
    const ra = FOLLOW_RANK[followUpState(a, today)];
    const rb = FOLLOW_RANK[followUpState(b, today)];
    if (ra !== rb) return ra - rb;
    const fa = a.next_follow_up ?? '9999-12-31';
    const fb = b.next_follow_up ?? '9999-12-31';
    if (fa !== fb) return fa < fb ? -1 : 1;
    return b.updated_at.localeCompare(a.updated_at);
  });
}

export interface PipelineSummary {
  counts: Record<ProspectStatus, number>;
  total: number;
  open: number;
  /** Sum of deal values on open (not won/lost) prospects, PER MARKET — naira
   *  and dollars are never added together. Unvalued = 0. */
  openValueByMarket: Record<Market, number>;
  wonValueByMarket: Record<Market, number>;
  /** Open prospects per market. */
  openByMarket: Record<Market, number>;
  overdue: number;
  dueToday: number;
}

export function pipelineSummary(list: readonly Prospect[], today: Date = new Date()): PipelineSummary {
  const counts = Object.fromEntries(PROSPECT_STATUSES.map((s) => [s.id, 0])) as Record<ProspectStatus, number>;
  const zero = () => Object.fromEntries(MARKETS.map((m) => [m.id, 0])) as Record<Market, number>;
  const openValueByMarket = zero(); const wonValueByMarket = zero(); const openByMarket = zero();
  let open = 0; let overdue = 0; let dueToday = 0;
  for (const p of list) {
    if (isProspectStatus(p.status)) counts[p.status] += 1;
    const value = p.deal_value_cents ?? 0;
    const market: Market = isMarket(p.market) ? p.market : DEFAULT_MARKET;
    if (isOpenStatus(p.status)) { open += 1; openValueByMarket[market] += value; openByMarket[market] += 1; }
    if (p.status === 'won') wonValueByMarket[market] += value;
    const s = followUpState(p, today);
    if (s === 'overdue') overdue += 1;
    if (s === 'today') dueToday += 1;
  }
  return { counts, total: list.length, open, openValueByMarket, wonValueByMarket, openByMarket, overdue, dueToday };
}

/** Touches (dm/email/call/meeting) `userId` logged on `now`'s LOCAL day. */
export function touchesToday(
  activities: readonly Pick<Activity, 'actor_id' | 'kind' | 'created_at'>[],
  userId: string,
  now: Date,
): number {
  const today = localDateKey(now);
  let n = 0;
  for (const a of activities) {
    if (a.actor_id !== userId || !isTouchKind(a.kind)) continue;
    const t = new Date(a.created_at);
    if (Number.isNaN(t.getTime())) continue;
    if (localDateKey(t) === today) n += 1;
  }
  return n;
}

/** Local midnight today, as ISO — the lower bound for listMyActivitiesSince. */
export function startOfLocalDayIso(now: Date): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

/** A touch on a brand-new prospect means they've now been contacted. */
export function statusAfterTouch(current: ProspectStatus, kind: ActivityKind): ProspectStatus {
  return current === 'new' && isTouchKind(kind) ? 'contacted' : current;
}

// ── Collateral ─────────────────────────────────────────────────────────────

/** Returns a NEW map: `id` stamped with `nowIso` when sent, removed when not. */
export function applyCollateral(
  current: Record<string, string> | null | undefined,
  id: string,
  sent: boolean,
  nowIso: string,
): Record<string, string> {
  const next: Record<string, string> = { ...(current ?? {}) };
  if (sent) next[id] = next[id] ?? nowIso;
  else delete next[id];
  return next;
}

/** origin + path (+ ?ref=code). Null when the item has no path. */
export function shareLink(origin: string, path: string | undefined, refCode: string | null | undefined): string | null {
  if (path === undefined) return null;
  let url: URL;
  try { url = new URL(path, origin); } catch { return null; }
  const ref = (refCode ?? '').trim();
  if (ref !== '') url.searchParams.set('ref', ref);
  return url.toString();
}

/**
 * Collateral for this prospect's checklist. `primary` = decks in THEIR market
 * (their ICP's deck first; every deck in that market for 'other') + the
 * market-free items. `other` = the other market's matching decks, shown
 * collapsed — a deck sent from there must still be tickable and visible.
 */
export function collateralFor(icp: CrmIcp, market: Market): { primary: CollateralItem[]; other: CollateralItem[] } {
  const fitsIcp = (c: CollateralItem) => c.icp === undefined || icp === 'other' || c.icp === icp;
  const decks = COLLATERAL.filter((c) => c.market !== undefined && fitsIcp(c));
  const generic = COLLATERAL.filter((c) => c.market === undefined && fitsIcp(c));
  return {
    primary: [...decks.filter((c) => c.market === market), ...generic],
    other: decks.filter((c) => c.market !== market),
  };
}

/** Templates for this prospect: ICP matches (or 'any') AND market matches (or 'any'). */
export function templatesFor(
  templates: readonly MessageTemplate[],
  icp: CrmIcp,
  market: Market,
): MessageTemplate[] {
  return templates.filter((t) => (t.icp === 'any' || t.icp === icp) && (t.market === 'any' || t.market === market));
}

// ── CSV ────────────────────────────────────────────────────────────────────

/**
 * One CSV cell. RFC 4180 quoting, plus formula-injection defence: a value a
 * spreadsheet would execute (leading = + - @, tab, CR) is prefixed with a
 * single quote. That will also prefix a phone like '+1 416…' — the cost of
 * the defence, and still readable.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const CSV_COLUMNS = [
  'name', 'company', 'role', 'type', 'market', 'status', 'email', 'phone', 'website', 'location', 'source',
  'deal_value', 'next_follow_up', 'last_contacted_at', ...SOCIAL_KEYS, 'notes', 'owner', 'created_at',
] as const;

export function prospectsToCsv(list: readonly Prospect[], ownerName: (ownerId: string | null) => string = () => ''): string {
  const rows: string[] = [CSV_COLUMNS.join(',')];
  for (const p of list) {
    const cells: unknown[] = [
      p.name, p.company, p.role, p.icp, p.market, p.status, p.email, p.phone, p.website, p.location, p.source,
      p.deal_value_cents === null ? '' : centsToInput(p.deal_value_cents),
      p.next_follow_up, p.last_contacted_at,
      ...SOCIAL_KEYS.map((k) => p.socials?.[k] ?? ''),
      p.notes, ownerName(p.owner_id), p.created_at,
    ];
    rows.push(cells.map(csvCell).join(','));
  }
  return rows.join('\r\n');
}

// ── Templates ──────────────────────────────────────────────────────────────

export interface TemplateSender {
  name: string;
  refCode?: string | null;
  origin: string;
  bookingLink?: string | null;
}

/**
 * Vars for salesContent.fillTemplate. Only keys we can fill honestly are set —
 * fillTemplate leaves the rest visible as [token] so a half-filled message is
 * obvious before it is sent (personalHook and eventType are always the rep's).
 */
export function templateVarsFor(
  prospect: Pick<Prospect, 'name' | 'company' | 'icp' | 'market'>,
  sender: TemplateSender,
): Partial<Record<TemplateToken, string>> {
  const vars: Partial<Record<TemplateToken, string>> = {};
  const first = prospect.name.trim().split(/\s+/)[0] ?? '';
  if (first !== '') vars.firstName = first;
  const company = (prospect.company ?? '').trim();
  if (company !== '') vars.company = company;
  const sender1 = sender.name.trim();
  if (sender1 !== '') vars.senderName = sender1;
  const deck = COLLATERAL.find((c) => c.market === prospect.market && c.icp === prospect.icp && c.path !== undefined);
  const link = shareLink(sender.origin, deck?.path, sender.refCode);
  if (link !== null) vars.deckLink = link;
  const booking = (sender.bookingLink ?? '').trim();
  if (booking !== '') vars.bookingLink = booking;
  return vars;
}

/** Strip a phone to what tel:/sms: accept. '' when nothing dialable is left. */
export function dialable(phone: string | null | undefined): string {
  const s = (phone ?? '').trim();
  const lead = s.startsWith('+') ? '+' : '';
  const digits = s.replace(/[^\d]/g, '');
  return digits === '' ? '' : `${lead}${digits}`;
}

/**
 * wa.me link, or null when the number can't be made fully international.
 * wa.me wants digits only, country code first, no '+', no leading 0.
 *  - '+234 803 123 4567' / '00234…' → as given
 *  - 'ng': a local '0803 123 4567' (11 digits, leading 0) → '234803…';
 *    '234…' already international
 *  - 'na': a 10-digit NANP number → '1' + number; '1' + 10 digits as is
 *  - anything else (too short/long for E.164, or ambiguous) → null
 */
export function whatsappLink(phone: string | null | undefined, market: Market): string | null {
  const s = (phone ?? '').trim();
  if (s === '') return null;
  let digits = s.replace(/[^\d]/g, '');
  if (digits === '') return null;
  if (s.startsWith('+')) {
    // already international
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (market === 'ng') {
    if (digits.length === 11 && digits.startsWith('0')) digits = `234${digits.slice(1)}`;
    else if (!(digits.startsWith('234') && digits.length === 13)) return null;
  } else {
    if (digits.length === 10 && !digits.startsWith('0') && !digits.startsWith('1')) digits = `1${digits}`;
    else if (!(digits.length === 11 && digits.startsWith('1'))) return null;
  }
  if (digits.startsWith('0') || digits.length < 8 || digits.length > 15) return null;
  return `https://wa.me/${digits}`;
}

// ── Errors ─────────────────────────────────────────────────────────────────

/** The fields of a PostgrestError we read. */
export interface CrmErrorLike { code?: string | null; message?: string | null; hint?: string | null }

export const NOT_SET_UP_MESSAGE = 'The CRM isn’t switched on in the database yet — ask Dapo to apply the sales migration.';

/** Postgres / PostgREST / network error → one calm sentence for the UI. */
export function friendlyCrmError(err: CrmErrorLike | null | undefined): string {
  if (err === null || err === undefined) return 'Something went wrong. Try again.';
  const code = err.code ?? '';
  const msg = err.message ?? '';
  if (msg.includes('no_account')) return 'That email doesn’t have a Beamwall account yet — ask them to sign up at /signup first.';
  if (code === '42501' || msg.includes('not_authorized') || msg.includes('row-level security')) {
    return 'You’re not authorised to do that.';
  }
  if (code === 'PGRST116') return 'That prospect isn’t yours to change, or it was just removed.';
  if (code === 'PGRST301' || /jwt/i.test(msg)) return 'Your session expired — sign in again.';
  if (code === '42P01' || code === '42883' || code === 'PGRST202' || code === 'PGRST205') return NOT_SET_UP_MESSAGE;
  if (code === '23505') return 'That ref code is already taken — try another.';
  if (code === '23514') return 'Something in that form is too long or not allowed.';
  if (code === '22023' || msg.includes('invalid_role')) return 'Pick rep or manager.';
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return 'Can’t reach Beamwall right now — check your connection and try again.';
  }
  return msg !== '' ? `Something went wrong: ${msg}` : 'Something went wrong. Try again.';
}

/** sales_grant_access ref_code rule (041 CHECK), applied after lower/trim. */
export function validRefCode(code: string): boolean {
  return /^[a-z0-9-]{2,24}$/.test(code.trim().toLowerCase());
}
