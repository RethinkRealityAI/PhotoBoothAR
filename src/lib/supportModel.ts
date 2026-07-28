/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure half of the support suite: the category catalogue, the suggestion
 * that puts the right pill first, the unread arithmetic, the status machine,
 * and — most importantly — diagnostics redaction.
 *
 * Kept free of React and of the Supabase client on purpose (the plans.ts
 * convention): the report dialog, the host ticket list, the admin inbox and the
 * tests all need these, and importing them must not drag in supabase.ts, whose
 * createClient throws without env vars.
 *
 * ── Why redaction lives here and is not optional ──
 * Supabase puts `#access_token=…&refresh_token=…` in the URL FRAGMENT after
 * magic-link, invite and password-recovery flows, and this app has a
 * /reset-password route. A diagnostics blob that captured `location.href` on
 * that page would write a session-granting secret into a table an operator
 * reads — exactly what docs/guardrails/PROJECT.md forbids ("Password-recovery
 * links are session-granting secrets — never log, store, or put them in
 * admin_audit.meta"). Everything that reports a URL goes through redactUrl()
 * first, including src/lib/errorReport.ts, which had this bug already.
 *
 * ── Why unread is only three timestamps ──
 * A ticket carries last_message_at plus one read pointer per side. The writer
 * stamps its OWN side's pointer when it posts (an author has, by definition,
 * read what they just wrote), so "unread for me" is the plain comparison below
 * with no need to know who the last author was.
 */

export type SupportCategory =
  | 'bug' | 'billing' | 'event_setup' | 'guest_issue'
  | 'feature_request' | 'account' | 'other';

export type SupportSource =
  | 'host_rail' | 'event_studio' | 'guest_booth' | 'manager_console'
  | 'error_boundary' | 'landing' | 'admin';

export type SupportStatus =
  | 'new' | 'open' | 'waiting_on_customer' | 'waiting_on_us' | 'resolved' | 'closed';

export type SupportPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface CategoryDef {
  id: SupportCategory;
  label: string;
  /** One line under the pill once chosen — sets the expectation of what to write. */
  hint: string;
  /** lucide-react icon name; the component maps it, so this stays React-free. */
  icon: string;
}

/** The pills, in their default (no-context) order. */
export const SUPPORT_CATEGORIES: CategoryDef[] = [
  { id: 'bug',             label: 'Something broke',   hint: 'A button, the camera, a page that will not load.', icon: 'Bug' },
  { id: 'event_setup',     label: 'Event setup',       hint: 'Frames, challenges, the wall, QR codes.',          icon: 'CalendarRange' },
  { id: 'guest_issue',     label: 'Guest problem',     hint: 'A guest could not post, or something looks wrong to them.', icon: 'Users' },
  { id: 'billing',         label: 'Billing',           hint: 'Charges, credits, plans, refunds.',                icon: 'Receipt' },
  { id: 'account',         label: 'Account',           hint: 'Sign-in, access, team members.',                   icon: 'ShieldCheck' },
  { id: 'feature_request', label: 'Feature request',   hint: 'Something you wish Beamwall did.',                 icon: 'Sparkles' },
  { id: 'other',           label: 'Something else',    hint: 'Anything that does not fit the rest.',             icon: 'MessageCircle' },
];

const CATEGORY_IDS: SupportCategory[] = SUPPORT_CATEGORIES.map((c) => c.id);

export function categoryDef(id: string): CategoryDef {
  return SUPPORT_CATEGORIES.find((c) => c.id === id) ?? SUPPORT_CATEGORIES[SUPPORT_CATEGORIES.length - 1];
}

export function isSupportCategory(v: unknown): v is SupportCategory {
  return typeof v === 'string' && (CATEGORY_IDS as string[]).includes(v);
}

/* ------------------------------------------------------------------ */
/* Suggestion                                                          */
/* ------------------------------------------------------------------ */

/** Keyword → category, checked against whatever the user has typed so far. */
const KEYWORD_HINTS: ReadonlyArray<readonly [RegExp, SupportCategory]> = [
  [/\b(charge[ds]?|refund|invoice|receipt|billing|credit|card declined|subscription|price|paid twice)\b/i, 'billing'],
  [/\b(sign ?in|log ?in|password|reset|locked out|access|invite|team|member|account)\b/i, 'account'],
  [/\b(crash|broke|broken|error|blank|frozen|freeze|stuck|not working|fails?|bug)\b/i, 'bug'],
  [/\b(guest|attendee|they can'?t|nobody can|visitors?)\b/i, 'guest_issue'],
  [/\b(frame|challenge|qr|wall|slug|branding|template|setup|set ?up)\b/i, 'event_setup'],
  [/\b(wish|could you add|feature|suggestion|would be (nice|great)|please add)\b/i, 'feature_request'],
];

/** The category each surface most often produces, best guess first. */
const SOURCE_HINTS: Record<SupportSource, SupportCategory[]> = {
  error_boundary:  ['bug'],
  guest_booth:     ['bug', 'guest_issue'],
  event_studio:    ['event_setup', 'bug'],
  manager_console: ['guest_issue', 'bug'],
  host_rail:       ['event_setup', 'billing'],
  landing:         ['other', 'feature_request'],
  admin:           ['other'],
};

/** Route → category, for the surfaces where the path says more than the source. */
const PATH_HINTS: ReadonlyArray<readonly [RegExp, SupportCategory]> = [
  [/^\/host\/billing/, 'billing'],
  [/^\/host\/events\//, 'event_setup'],
  [/^\/host\/new/, 'event_setup'],
  [/^\/e\//, 'guest_issue'],
  [/^\/m\//, 'guest_issue'],
  [/^\/(login|signup|forgot-password|reset-password)/, 'account'],
];

/**
 * Every category, reordered so the most likely ones come first.
 *
 * Always returns the FULL list — a suggestion that hid the other options would
 * make a mis-guess unrecoverable, and the pills are the whole point of the
 * dialog. Signal order: what the user typed beats the route, which beats the
 * surface they clicked from.
 */
export function suggestCategories(
  source: SupportSource | null | undefined,
  pathname: string | null | undefined,
  text: string | null | undefined = '',
): SupportCategory[] {
  const ranked: SupportCategory[] = [];
  const push = (id: SupportCategory) => { if (!ranked.includes(id)) ranked.push(id); };

  const typed = (text ?? '').trim();
  if (typed !== '') {
    for (const [re, id] of KEYWORD_HINTS) if (re.test(typed)) push(id);
  }

  const path = pathname ?? '';
  if (path !== '') {
    for (const [re, id] of PATH_HINTS) if (re.test(path)) push(id);
  }

  if (source !== null && source !== undefined) {
    for (const id of SOURCE_HINTS[source] ?? []) push(id);
  }

  for (const id of CATEGORY_IDS) push(id);
  return ranked;
}

/* ------------------------------------------------------------------ */
/* Redaction                                                           */
/* ------------------------------------------------------------------ */

/** Query params whose VALUE must never be stored. Matched case-insensitively. */
const SECRET_PARAM = /(access|refresh|id)_token|token|code|key|secret|password|apikey|api_key/i;

export const REDACTED = '[redacted]';

/**
 * A URL safe to store in a support ticket or an error report.
 *
 * The whole fragment goes, unconditionally — Supabase auth returns
 * `#access_token=…&refresh_token=…&type=recovery` there, and no fragment this
 * app produces is worth the risk of keeping one that isn't checked. Token-shaped
 * query params keep their key (so an operator can still see the shape of the
 * link) and lose their value.
 *
 * Never throws: it is called from error paths, including the global handler.
 */
export function redactUrl(raw: string | null | undefined, maxLen = 500): string {
  const input = (raw ?? '').trim();
  if (input === '') return '';
  try {
    const u = new URL(input);
    u.hash = '';
    const params = u.searchParams;
    for (const key of Array.from(params.keys())) {
      if (SECRET_PARAM.test(key)) params.set(key, REDACTED);
    }
    u.search = params.toString();
    return u.toString().slice(0, maxLen);
  } catch {
    // Not parseable as an absolute URL (a bare path, or something malformed).
    // Fall back to the blunt version: everything from the first '#' or '?' is
    // dropped. Losing a query string is cheap; keeping a token is not.
    return input.split('#')[0].split('?')[0].slice(0, maxLen);
  }
}

/** Redact every string field of a diagnostics bag that could hold a URL. */
export function redactDiagnostics(
  diag: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(diag ?? {})) {
    if (typeof v !== 'string') { out[k] = v; continue; }
    out[k] = /url|href|location|referrer/i.test(k) ? redactUrl(v) : v;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Unread                                                              */
/* ------------------------------------------------------------------ */

export interface UnreadFields {
  last_message_at: string | null;
  customer_last_read_at: string | null;
  admin_last_read_at: string | null;
}

function newerThan(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a === null || a === undefined || a === '') return false;
  const at = Date.parse(a);
  if (Number.isNaN(at)) return false;
  if (b === null || b === undefined || b === '') return true; // never read
  const bt = Date.parse(b);
  if (Number.isNaN(bt)) return true;
  // Strictly greater: a pointer stamped in the same instant as the message
  // means the reader IS the author, which is read, not unread.
  return at > bt;
}

export function unreadForCustomer(t: UnreadFields): boolean {
  return newerThan(t.last_message_at, t.customer_last_read_at);
}

export function unreadForAdmin(t: UnreadFields): boolean {
  return newerThan(t.last_message_at, t.admin_last_read_at);
}

export function unreadCount(tickets: UnreadFields[], side: 'customer' | 'admin'): number {
  const test = side === 'admin' ? unreadForAdmin : unreadForCustomer;
  return tickets.reduce((n, t) => (test(t) ? n + 1 : n), 0);
}

/* ------------------------------------------------------------------ */
/* Status machine                                                      */
/* ------------------------------------------------------------------ */

const OPEN_STATUSES: SupportStatus[] = ['new', 'open', 'waiting_on_customer', 'waiting_on_us'];

export function isOpenStatus(s: SupportStatus): boolean {
  return OPEN_STATUSES.includes(s);
}

/**
 * Where a ticket lands when the CUSTOMER writes.
 *
 * A reply on a resolved ticket reopens it. Somebody who was told "fixed" and
 * writes back has not been helped, and silently appending to a resolved thread
 * is how that goes unnoticed. `closed` is the one terminal state — it does not
 * reopen, so a long-dead thread can't be resurrected by a stray reply.
 */
export function statusAfterCustomerReply(current: SupportStatus): SupportStatus {
  if (current === 'closed') return 'closed';
  return 'waiting_on_us';
}

/** Where a ticket lands when an OPERATOR writes a non-internal reply. */
export function statusAfterAdminReply(current: SupportStatus): SupportStatus {
  if (current === 'closed' || current === 'resolved') return current;
  return 'waiting_on_customer';
}

/** Operator-driven transitions. Anything may be reopened except from closed. */
export function canTransition(from: SupportStatus, to: SupportStatus): boolean {
  if (from === to) return false;
  if (from === 'closed') return to === 'open';
  return true;
}
