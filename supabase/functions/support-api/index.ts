/**
 * support-api — every write in the support suite, both sides of the desk.
 *
 * POST { action, args? }
 *   (deployed with verify_jwt ON — the anon key passes it, which is what lets a
 *    guest whose booth just broke file a ticket with no account. Whether a REAL
 *    user JWT is present is what selects the auth mode below.)
 *
 * CUSTOMER / GUEST
 *   create_ticket { subject, body, category, source, eventSlug?, diagnostics?,
 *                   sessionId?, attachmentPaths?, reporterEmail?, reporterName? }
 *                 → { ticket: { id, publicRef, status }, emailed }
 *   reply         { ticketId, body }        → { message: { id }, emailed }
 *   my_counts     {}                        → { unread }
 *
 * PLATFORM ADMIN (is_platform_admin asserted BEFORE the dispatch switch)
 *   admin_list_tickets { search?, status?, priority?, category?, unreadOnly?,
 *                        limit?, offset? }  → { tickets, hasMore, total }
 *   admin_get_ticket   { ticketId }         → { ticket, messages, org, event, recentErrors }
 *   admin_reply        { ticketId, body, internal? } → { message, emailed }
 *   admin_set_status   { ticketId, status } → { ticket }
 *   admin_set_priority { ticketId, priority } → { ticket }
 *   admin_assign       { ticketId, userId | null } → { ticket }
 *   admin_mark_read    { ticketId }         → { ok: true }
 *   admin_counts       {}                   → { unread, open }
 *
 * 400 → invalid_json | invalid_body | invalid_args | unknown_action
 * 401 → unauthorized            403 → forbidden
 * 404 → ticket_not_found | event_not_found
 * 429 → rate_limited            500 → internal
 *
 * WHY THIS IS NOT IN admin-api: the customer half is anonymous-capable and
 * email-bearing, and admin-api is is_platform_admin-gated by construction with
 * no email code in it. Splitting the two halves across two functions would mean
 * two copies of the branded HTML template — the exact copy-paste failure this
 * codebase has already been burned by four times with the entitlements table.
 * So both halves live here, and admin-api's structural guard (assert BEFORE the
 * switch, so a new action cannot forget its gate) is reproduced verbatim.
 *
 * EMAIL IS NEVER LOAD-BEARING. A ticket must not fail because Resend did. Every
 * send is attempted after the row is committed, its outcome is recorded on the
 * message (email_sent_at / email_error), and the response reports `emailed` so
 * the UI can be honest rather than implying delivery it cannot confirm.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Pragmatic shape check, not RFC 5322 — Resend enforces the rest.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Mirrors of the CHECK constraints in migration 023. Kept in sync by the DB
// refusing anything these let through — the constraint is the authority, this
// is only so a too-long body comes back as a clean 400 instead of a 500.
const CATEGORIES = new Set([
  'bug', 'billing', 'event_setup', 'guest_issue', 'feature_request', 'account', 'other',
]);
const SOURCES = new Set([
  'host_rail', 'event_studio', 'guest_booth', 'manager_console',
  'error_boundary', 'landing', 'admin',
]);
const STATUSES = new Set([
  'new', 'open', 'waiting_on_customer', 'waiting_on_us', 'resolved', 'closed',
]);
const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

const MAX_SUBJECT = 200;
const MAX_BODY = 10_000;
const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

/** Actions that require a platform admin. Asserted before dispatch. */
const ADMIN_ACTIONS = new Set([
  'admin_list_tickets', 'admin_get_ticket', 'admin_reply', 'admin_set_status',
  'admin_set_priority', 'admin_assign', 'admin_mark_read', 'admin_counts',
]);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Success envelope. admin-api and manager-api both wrap their payload in
 *  `{ data }`, and src/lib/*.ts unwraps that shape; staying consistent means
 *  the support client is the same three lines as adminApi(). */
function ok(body: unknown): Response {
  return json(200, { data: body });
}

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

type Client = ReturnType<typeof serviceClient>;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** Escape a user-typed search term for a PostgREST `ilike` pattern (admin-api's
 *  likeTerm, same reasoning: % and _ are wildcards and , or ) breaks the filter). */
function likeTerm(search: string): string {
  return `%${search.replace(/[\\%_,()]/g, (c) => `\\${c}`)}%`;
}

function paging(args: Record<string, unknown>): { limit: number; offset: number; search: string } {
  const rawLimit = typeof args.limit === 'number' && Number.isFinite(args.limit)
    ? Math.round(args.limit) : DEFAULT_PAGE;
  const rawOffset = typeof args.offset === 'number' && Number.isFinite(args.offset)
    ? Math.round(args.offset) : 0;
  return {
    limit: Math.max(1, Math.min(rawLimit, MAX_PAGE)),
    offset: Math.max(0, rawOffset),
    search: typeof args.search === 'string' ? args.search.trim().slice(0, 100) : '',
  };
}

function page<T>(rows: T[], limit: number): { rows: T[]; hasMore: boolean } {
  return rows.length > limit ? { rows: rows.slice(0, limit), hasMore: true } : { rows, hasMore: false };
}

/* ------------------------------------------------------------------ */
/* Email — beam identity, not the cards' gold                          */
/* ------------------------------------------------------------------ */
/* card-publish's cardEmailHtml is the keepsake product's voice (serif, gold,
 * "a card made for you"). Support mail is PLATFORM mail, so it uses the void /
 * beam palette from src/index.css @theme that /host and /admin render in:
 * bg #05060B, panel #12141F, fg #EEF3FF, muted #A9B4CC, accent #5B8CFF. */

function shell(preheader: string, inner: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#05060B;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
    <div style="max-width:560px;margin:0 auto;padding:40px 24px;font-family:Inter,Helvetica,Arial,sans-serif;color:#EEF3FF;">
      <p style="text-align:center;font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:#5B8CFF;margin:0 0 24px;">Beamwall Support</p>
      <div style="border:1px solid rgba(91,140,255,0.22);border-radius:20px;padding:32px 28px;background:#12141F;">
${inner}
      </div>
      <p style="text-align:center;font-size:11px;color:#6C7793;margin:24px 0 0;">Beamwall · you're receiving this because you contacted support.</p>
    </div>
  </body>
</html>`;
}

function refBadge(ref: string): string {
  return `<p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#A9B4CC;margin:0 0 14px;">Ref ${escapeHtml(ref)}</p>`;
}

/** Sent to the reporter the moment a ticket lands. Promises no SLA we do not have. */
function ackHtml(ref: string, subject: string, categoryLabel: string, link: string | null): string {
  const cta = link === null ? '' : `
        <p style="margin:26px 0 0;"><a href="${escapeHtml(link)}" style="display:inline-block;background:#5B8CFF;color:#05060B;text-decoration:none;font-size:12px;font-weight:bold;letter-spacing:0.16em;text-transform:uppercase;padding:14px 30px;border-radius:999px;">View your request</a></p>`;
  return shell(`We've got your report — ${ref}`, `
        ${refBadge(ref)}
        <h1 style="font-size:21px;line-height:1.35;color:#EEF3FF;margin:0 0 14px;font-weight:600;">We've got it.</h1>
        <p style="font-size:14px;line-height:1.65;color:#A9B4CC;margin:0 0 18px;">Thanks for telling us. A real person reads every one of these, and we'll reply to this address as soon as we've looked into it.</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;color:#A9B4CC;">
          <tr><td style="padding:6px 0;width:88px;color:#6C7793;">Type</td><td style="padding:6px 0;color:#EEF3FF;">${escapeHtml(categoryLabel)}</td></tr>
          <tr><td style="padding:6px 0;color:#6C7793;">Summary</td><td style="padding:6px 0;color:#EEF3FF;">${escapeHtml(subject)}</td></tr>
        </table>${cta}`);
}

/** Sent to the reporter when an operator replies. */
function replyHtml(ref: string, subject: string, body: string, link: string | null): string {
  const quoted = escapeHtml(body).replace(/\n/g, '<br>');
  const cta = link === null ? '' : `
        <p style="margin:24px 0 0;"><a href="${escapeHtml(link)}" style="display:inline-block;background:#5B8CFF;color:#05060B;text-decoration:none;font-size:12px;font-weight:bold;letter-spacing:0.16em;text-transform:uppercase;padding:14px 30px;border-radius:999px;">Open the conversation</a></p>`;
  return shell(`Reply to ${ref}: ${subject}`, `
        ${refBadge(ref)}
        <h1 style="font-size:19px;line-height:1.35;color:#EEF3FF;margin:0 0 16px;font-weight:600;">${escapeHtml(subject)}</h1>
        <div style="font-size:14px;line-height:1.7;color:#D5DDF0;border-left:2px solid #5B8CFF;padding-left:16px;margin:0;">${quoted}</div>${cta}
        <p style="font-size:12px;line-height:1.6;color:#6C7793;margin:22px 0 0;">Just reply to this email if you need anything else — it lands on the same thread.</p>`);
}

/** Sent to the operator when anything arrives. Terse on purpose: it is a nudge. */
function notifyHtml(
  ref: string, subject: string, body: string, category: string,
  who: string, where: string, link: string,
): string {
  const quoted = escapeHtml(body).replace(/\n/g, '<br>');
  return shell(`${category}: ${subject}`, `
        ${refBadge(ref)}
        <h1 style="font-size:19px;line-height:1.35;color:#EEF3FF;margin:0 0 8px;font-weight:600;">${escapeHtml(subject)}</h1>
        <p style="font-size:12px;color:#6C7793;margin:0 0 18px;">${escapeHtml(category)} · ${escapeHtml(who)} · ${escapeHtml(where)}</p>
        <div style="font-size:14px;line-height:1.7;color:#D5DDF0;border-left:2px solid #5B8CFF;padding-left:16px;">${quoted}</div>
        <p style="margin:24px 0 0;"><a href="${escapeHtml(link)}" style="display:inline-block;background:#5B8CFF;color:#05060B;text-decoration:none;font-size:12px;font-weight:bold;letter-spacing:0.16em;text-transform:uppercase;padding:14px 30px;border-radius:999px;">Open in admin</a></p>`);
}

function siteBase(): string {
  // Trusted config only. The request Origin header is attacker-controllable and
  // is deliberately NOT used (card-publish makes the same call for the same reason).
  return Deno.env.get('PUBLIC_SITE_URL')?.replace(/\/$/, '') || 'https://beamwall.app';
}

/**
 * Best-effort Resend send.
 *
 * Returns the failure as a VALUE, never as a throw: every caller has already
 * committed a row by this point, and a support ticket that 500s after it was
 * saved is worse than one that quietly went un-emailed.
 */
async function sendMail(
  to: string, subject: string, html: string,
): Promise<{ sent: boolean; error: string | null }> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return { sent: false, error: 'not_configured' };
  if (!EMAIL_RE.test(to)) return { sent: false, error: 'invalid_recipient' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        from: Deno.env.get('SUPPORT_FROM_EMAIL') || 'Beamwall Support <support@beamwall.app>',
        to,
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[support-api] resend error', res.status, detail);
      return { sent: false, error: `resend_${res.status}` };
    }
    return { sent: true, error: null };
  } catch (err) {
    console.error('[support-api] resend request failed', err);
    return { sent: false, error: 'resend_unreachable' };
  }
}

function operatorEmail(): string {
  return Deno.env.get('SUPPORT_NOTIFY_EMAIL') || 'dapo@rethinkreality.ai';
}

/** Record the outcome of a send on the message row. Never throws. */
async function stampEmail(
  sb: Client, messageId: string, outcome: { sent: boolean; error: string | null },
): Promise<void> {
  const { error } = await sb
    .from('support_messages')
    .update({
      email_sent_at: outcome.sent ? new Date().toISOString() : null,
      email_error: outcome.error,
    })
    .eq('id', messageId);
  if (error) console.error('[support-api] stampEmail failed', error);
}

/* ------------------------------------------------------------------ */
/* Customer actions                                                    */
/* ------------------------------------------------------------------ */

async function createTicket(
  sb: Client,
  args: Record<string, unknown>,
  user: { id: string; email?: string | null } | null,
): Promise<Response> {
  const subject = str(args.subject, MAX_SUBJECT);
  const body = str(args.body, MAX_BODY);
  const category = str(args.category, 40);
  const source = str(args.source, 40);
  if (subject === '' || body === '') return json(400, { error: 'invalid_body' });
  if (!CATEGORIES.has(category)) return json(400, { error: 'invalid_args' });
  if (!SOURCES.has(source)) return json(400, { error: 'invalid_args' });

  const eventSlug = str(args.eventSlug, 64) || null;
  const sessionId = str(args.sessionId, 200) || null;
  const diagnostics =
    args.diagnostics !== null && typeof args.diagnostics === 'object' && !Array.isArray(args.diagnostics)
      ? args.diagnostics as Record<string, unknown>
      : {};

  // Resolve the event (if any) so the ticket carries BOTH keys.
  let eventId: string | null = null;
  let eventOrg: string | null = null;
  let eventName: string | null = null;
  if (eventSlug !== null) {
    const { data: ev, error } = await sb
      .from('events').select('id, org_id, name').eq('slug', eventSlug).maybeSingle();
    if (error) throw error;
    if (ev) {
      eventId = ev.id as string;
      eventOrg = ev.org_id as string;
      eventName = ev.name as string;
    }
    // A slug that resolves to nothing is NOT an error: the slug column exists
    // precisely so a report about a mistyped or deleted event still lands.
  }

  // Tenancy. org_id is derived server-side and never read from the body.
  let orgId: string | null = null;
  let reporterEmail = str(args.reporterEmail, 320);
  let reporterName = str(args.reporterName, 200) || null;

  if (user !== null) {
    reporterEmail = (user.email ?? '').trim() || reporterEmail;
    const { data: mem, error } = await sb
      .from('org_members').select('org_id').eq('user_id', user.id).limit(1).maybeSingle();
    if (error) throw error;
    orgId = (mem?.org_id as string | undefined) ?? null;
    // A host reporting about an event they belong to files under THAT org.
    if (eventOrg !== null) {
      const { data: owns, error: ownErr } = await sb
        .from('org_members').select('org_id')
        .eq('user_id', user.id).eq('org_id', eventOrg).maybeSingle();
      if (ownErr) throw ownErr;
      if (owns) orgId = eventOrg;
    }
  } else {
    // Anonymous guest: the ticket is attributed to the event's org so the HOST
    // of that event can see it, which is the routing the platform owner chose.
    orgId = eventOrg;
    if (reporterEmail !== '' && !EMAIL_RE.test(reporterEmail)) {
      return json(400, { error: 'invalid_args' });
    }
  }

  if (reporterEmail === '' && user === null) {
    // A guest who leaves no address cannot be replied to — allowed, but the DB
    // CHECK requires one of the two, so record the absence explicitly.
    reporterEmail = '';
  }

  const insert: Record<string, unknown> = {
    org_id: orgId,
    event_id: eventId,
    event_slug: eventSlug,
    created_by: user?.id ?? null,
    reporter_email: reporterEmail === '' ? null : reporterEmail,
    reporter_name: reporterName,
    source,
    category,
    subject,
    diagnostics,
    session_id: sessionId,
    status: 'new',
  };

  const { data: ticket, error: tErr } = await sb
    .from('support_tickets').insert(insert)
    .select('id, public_ref, status, created_at').single();

  if (tErr) {
    // The 024 rate guard RAISES (unlike 021's silent drop) precisely so this
    // surfaces to the person who pressed the button.
    if ((tErr.message ?? '').includes('support_rate_limited')) {
      return json(429, { error: 'rate_limited' });
    }
    if ((tErr.code ?? '') === '23514') return json(400, { error: 'invalid_body' });
    throw tErr;
  }

  const ticketId = ticket.id as string;
  const ref = ticket.public_ref as string;

  const { data: msg, error: mErr } = await sb
    .from('support_messages')
    .insert({
      ticket_id: ticketId,
      author_kind: 'customer',
      author_user_id: user?.id ?? null,
      author_email: reporterEmail === '' ? null : reporterEmail,
      body,
      internal: false,
    })
    .select('id').single();
  if (mErr) throw mErr;

  await sb.from('support_tickets')
    .update({ last_message_at: new Date().toISOString(), customer_last_read_at: new Date().toISOString() })
    .eq('id', ticketId);

  // ── Email. Past this point nothing may fail the request. ──
  const site = siteBase();
  const categoryLabel = category.replace(/_/g, ' ');
  const who = user !== null ? (reporterEmail || 'a signed-in host') : 'a guest';
  const where = eventName !== null ? eventName : (eventSlug ?? 'the platform');

  const notify = await sendMail(
    operatorEmail(),
    `[${ref}] ${categoryLabel}: ${subject}`,
    notifyHtml(ref, subject, body, categoryLabel, who, where, `${site}/admin/support?t=${ticketId}`),
  );
  if (!notify.sent) console.error('[support-api] operator notify failed', notify.error);

  let emailed = false;
  if (reporterEmail !== '') {
    const ack = await sendMail(
      reporterEmail,
      `We've got your report (${ref})`,
      ackHtml(ref, subject, categoryLabel, user !== null ? `${site}/host/support` : null),
    );
    emailed = ack.sent;
    await stampEmail(sb, msg.id as string, ack);
  }

  return ok({
    ticket: { id: ticketId, publicRef: ref, status: ticket.status, createdAt: ticket.created_at },
    emailed,
  });
}

async function customerReply(
  sb: Client, args: Record<string, unknown>, user: { id: string; email?: string | null },
): Promise<Response> {
  const ticketId = str(args.ticketId, 64);
  const body = str(args.body, MAX_BODY);
  if (!UUID_RE.test(ticketId) || body === '') return json(400, { error: 'invalid_body' });

  const { data: ticket, error } = await sb
    .from('support_tickets')
    .select('id, org_id, status, public_ref, subject')
    .eq('id', ticketId).maybeSingle();
  if (error) throw error;
  if (!ticket) return json(404, { error: 'ticket_not_found' });
  if (ticket.org_id === null) return json(403, { error: 'forbidden' });

  // Membership verified server-side against the JWT sub, never a body field.
  const { data: mem, error: memErr } = await sb
    .from('org_members').select('org_id')
    .eq('user_id', user.id).eq('org_id', ticket.org_id as string).maybeSingle();
  if (memErr) throw memErr;
  if (!mem) return json(403, { error: 'forbidden' });

  const { data: msg, error: mErr } = await sb
    .from('support_messages')
    .insert({
      ticket_id: ticketId,
      author_kind: 'customer',
      author_user_id: user.id,
      author_email: user.email ?? null,
      body,
      internal: false,
    })
    .select('id, created_at').single();
  if (mErr) throw mErr;

  // A reply on a resolved ticket reopens it: somebody told "fixed" who writes
  // back has not been helped. `closed` is terminal. (Mirrors
  // statusAfterCustomerReply in src/lib/supportModel.ts.)
  const nextStatus = ticket.status === 'closed' ? 'closed' : 'waiting_on_us';
  const now = new Date().toISOString();
  await sb.from('support_tickets')
    .update({ status: nextStatus, last_message_at: now, customer_last_read_at: now })
    .eq('id', ticketId);

  const site = siteBase();
  const notify = await sendMail(
    operatorEmail(),
    `[${ticket.public_ref}] reply: ${ticket.subject}`,
    notifyHtml(
      ticket.public_ref as string, ticket.subject as string, body, 'customer reply',
      user.email ?? 'a host', 'reply', `${site}/admin/support?t=${ticketId}`,
    ),
  );
  if (!notify.sent) console.error('[support-api] operator notify failed', notify.error);

  return ok({ message: { id: msg.id, createdAt: msg.created_at }, status: nextStatus, emailed: notify.sent });
}

async function myCounts(sb: Client, user: { id: string }): Promise<Response> {
  const { data: mems, error } = await sb
    .from('org_members').select('org_id').eq('user_id', user.id);
  if (error) throw error;
  const orgIds = (mems ?? []).map((m) => m.org_id as string);
  if (orgIds.length === 0) return ok({ unread: 0 });

  // head:true — a count over the partial index from 025, not a row fetch.
  const { count, error: tErr } = await sb
    .from('support_tickets')
    .select('id', { count: 'exact', head: true })
    .in('org_id', orgIds)
    .eq('customer_unread', true);
  if (tErr) throw tErr;
  return ok({ unread: count ?? 0 });
}

/* ------------------------------------------------------------------ */
/* Admin actions                                                       */
/* ------------------------------------------------------------------ */

const TICKET_COLS =
  'id, public_ref, org_id, event_id, event_slug, created_by, reporter_email, reporter_name,' +
  ' source, category, priority, status, subject, assigned_to, diagnostics, session_id,' +
  ' first_response_at, resolved_at, customer_last_read_at, admin_last_read_at,' +
  ' admin_unread, customer_unread, last_message_at, created_at, updated_at';

async function adminListTickets(sb: Client, args: Record<string, unknown>): Promise<Response> {
  const { limit, offset, search } = paging(args);
  // `count: 'exact'` rides the SAME request (PostgREST answers it in
  // Content-Range), so how many tickets match the filter costs no extra round
  // trip — and `.range()` here is offset/limit query params, not a Range
  // header, so an offset past the end is an empty page rather than a 416.
  let q = sb.from('support_tickets').select(TICKET_COLS, { count: 'exact' })
    .order('last_message_at', { ascending: false })
    .range(offset, offset + limit); // +1 sentinel row

  const status = str(args.status, 40);
  if (STATUSES.has(status)) q = q.eq('status', status);
  else if (status === 'open') q = q.in('status', ['new', 'open', 'waiting_on_customer', 'waiting_on_us']);

  const priority = str(args.priority, 20);
  if (PRIORITIES.has(priority)) q = q.eq('priority', priority);

  const category = str(args.category, 40);
  if (CATEGORIES.has(category)) q = q.eq('category', category);

  // Filtered in the DATABASE, before paging — 025 made unread a stored
  // generated column precisely so this cannot page over a filtered subset.
  if (args.unreadOnly === true) q = q.eq('admin_unread', true);

  if (search !== '') {
    const term = likeTerm(search);
    q = q.or(`subject.ilike.${term},public_ref.ilike.${term},reporter_email.ilike.${term},event_slug.ilike.${term}`);
  }

  const { data, error, count } = await q;
  if (error) throw error;

  const { rows: trimmed, hasMore } = page(data ?? [], limit);

  // Resolve org names in one round trip so the inbox can show WHO, not a uuid.
  const orgIds = [...new Set(trimmed.map((t) => t.org_id).filter((v): v is string => typeof v === 'string'))];
  const orgNames = new Map<string, string>();
  if (orgIds.length > 0) {
    const { data: orgs, error: oErr } = await sb.from('orgs').select('id, name').in('id', orgIds);
    if (oErr) throw oErr;
    for (const o of orgs ?? []) orgNames.set(o.id as string, o.name as string);
  }

  return ok({
    tickets: trimmed.map((t) => ({ ...t, org_name: orgNames.get(t.org_id as string) ?? null })),
    hasMore,
    // How many match the filter, not how many were sent. `hasMore` stays the
    // sentinel and remains the authority for "is there another page": the count
    // and the page are one statement apart, but a concurrent write between the
    // two would still be a disagreement, and the sentinel is the half that
    // cannot disagree with itself.
    total: count ?? null,
  });
}

async function adminGetTicket(sb: Client, args: Record<string, unknown>): Promise<Response> {
  const ticketId = str(args.ticketId, 64);
  if (!UUID_RE.test(ticketId)) return json(400, { error: 'invalid_args' });

  const { data: ticket, error } = await sb
    .from('support_tickets').select(TICKET_COLS).eq('id', ticketId).maybeSingle();
  if (error) throw error;
  if (!ticket) return json(404, { error: 'ticket_not_found' });

  // The operator sees internal notes; the customer's RLS policy never does.
  const { data: messages, error: mErr } = await sb
    .from('support_messages')
    .select('id, author_kind, author_user_id, author_email, body, internal, attachments, email_sent_at, email_error, created_at')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });
  if (mErr) throw mErr;

  let org: { id: string; name: string } | null = null;
  if (typeof ticket.org_id === 'string') {
    const { data: o } = await sb.from('orgs').select('id, name').eq('id', ticket.org_id).maybeSingle();
    org = o ? { id: o.id as string, name: o.name as string } : null;
  }

  let event: { id: string; name: string; slug: string; status: string } | null = null;
  if (typeof ticket.event_id === 'string') {
    const { data: e } = await sb.from('events').select('id, name, slug, status').eq('id', ticket.event_id).maybeSingle();
    event = e ? { id: e.id as string, name: e.name as string, slug: e.slug as string, status: e.status as string } : null;
  }

  // THE join that makes this table worth having: the stack traces the same
  // browser session reported around the time the human filed the ticket.
  let recentErrors: unknown[] = [];
  if (typeof ticket.session_id === 'string' && ticket.session_id !== '') {
    const { data: errs } = await sb
      .from('client_errors')
      .select('id, message, url, created_at')
      .eq('session_id', ticket.session_id)
      .order('created_at', { ascending: false })
      .limit(10);
    recentErrors = errs ?? [];
  }

  return ok({ ticket, messages: messages ?? [], org, event, recentErrors });
}

async function adminReply(
  sb: Client, args: Record<string, unknown>, actorId: string, actorEmail: string | null,
): Promise<Response> {
  const ticketId = str(args.ticketId, 64);
  const body = str(args.body, MAX_BODY);
  const internal = args.internal === true;
  if (!UUID_RE.test(ticketId) || body === '') return json(400, { error: 'invalid_body' });

  const { data: ticket, error } = await sb
    .from('support_tickets')
    .select('id, public_ref, subject, status, reporter_email, created_by, first_response_at')
    .eq('id', ticketId).maybeSingle();
  if (error) throw error;
  if (!ticket) return json(404, { error: 'ticket_not_found' });

  const { data: msg, error: mErr } = await sb
    .from('support_messages')
    .insert({
      ticket_id: ticketId,
      author_kind: 'admin',
      author_user_id: actorId,
      author_email: actorEmail,
      body,
      internal,
    })
    .select('id, created_at').single();
  if (mErr) throw mErr;

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { admin_last_read_at: now };
  if (!internal) {
    // An internal note is not a reply: it must not move the ticket, restart the
    // customer's clock, or count as our first response.
    patch.last_message_at = now;
    patch.status = (ticket.status === 'closed' || ticket.status === 'resolved')
      ? ticket.status : 'waiting_on_customer';
    if (ticket.first_response_at === null) patch.first_response_at = now;
  }
  await sb.from('support_tickets').update(patch).eq('id', ticketId);

  await sb.from('admin_audit').insert({
    actor_user_id: actorId,
    action: internal ? 'support_internal_note' : 'support_reply',
    target_type: 'support_ticket',
    target_id: ticketId,
    meta: { ref: ticket.public_ref, chars: body.length },
  });

  let emailed = false;
  if (!internal) {
    const recipient = (ticket.reporter_email as string | null) ?? '';
    if (recipient !== '') {
      const site = siteBase();
      const out = await sendMail(
        recipient,
        `Re: ${ticket.subject} (${ticket.public_ref})`,
        replyHtml(
          ticket.public_ref as string, ticket.subject as string, body,
          ticket.created_by !== null ? `${site}/host/support` : null,
        ),
      );
      emailed = out.sent;
      await stampEmail(sb, msg.id as string, out);
    }
  }

  return ok({ message: { id: msg.id, createdAt: msg.created_at }, emailed });
}

async function adminPatch(
  sb: Client, args: Record<string, unknown>, actorId: string,
  field: 'status' | 'priority' | 'assigned_to',
): Promise<Response> {
  const ticketId = str(args.ticketId, 64);
  if (!UUID_RE.test(ticketId)) return json(400, { error: 'invalid_args' });

  const patch: Record<string, unknown> = {};
  if (field === 'status') {
    const status = str(args.status, 40);
    if (!STATUSES.has(status)) return json(400, { error: 'invalid_args' });
    patch.status = status;
    patch.resolved_at = (status === 'resolved' || status === 'closed') ? new Date().toISOString() : null;
  } else if (field === 'priority') {
    const priority = str(args.priority, 20);
    if (!PRIORITIES.has(priority)) return json(400, { error: 'invalid_args' });
    patch.priority = priority;
  } else {
    const userId = args.userId;
    if (userId !== null && !(typeof userId === 'string' && UUID_RE.test(userId))) {
      return json(400, { error: 'invalid_args' });
    }
    patch.assigned_to = userId;
  }

  const { data, error } = await sb
    .from('support_tickets').update(patch).eq('id', ticketId).select(TICKET_COLS).maybeSingle();
  if (error) throw error;
  if (!data) return json(404, { error: 'ticket_not_found' });

  await sb.from('admin_audit').insert({
    actor_user_id: actorId,
    action: `support_set_${field}`,
    target_type: 'support_ticket',
    target_id: ticketId,
    meta: patch,
  });

  return ok({ ticket: data });
}

async function adminMarkRead(sb: Client, args: Record<string, unknown>): Promise<Response> {
  const ticketId = str(args.ticketId, 64);
  if (!UUID_RE.test(ticketId)) return json(400, { error: 'invalid_args' });
  const { error } = await sb
    .from('support_tickets')
    .update({ admin_last_read_at: new Date().toISOString() })
    .eq('id', ticketId);
  if (error) throw error;
  return ok({ ok: true });
}

async function adminCounts(sb: Client): Promise<Response> {
  // Two index counts, no row fetch — this runs on every admin page load.
  const [unreadRes, openRes] = await Promise.all([
    sb.from('support_tickets').select('id', { count: 'exact', head: true })
      .eq('admin_unread', true),
    sb.from('support_tickets').select('id', { count: 'exact', head: true })
      .in('status', ['new', 'open', 'waiting_on_customer', 'waiting_on_us']),
  ]);
  if (unreadRes.error) throw unreadRes.error;
  if (openRes.error) throw openRes.error;
  return ok({ unread: unreadRes.count ?? 0, open: openRes.count ?? 0 });
}

/* ------------------------------------------------------------------ */
/* Entry                                                               */
/* ------------------------------------------------------------------ */

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  try {
    const action = typeof body.action === 'string' ? body.action : '';
    const args = (body.args !== null && typeof body.args === 'object' && !Array.isArray(body.args))
      ? body.args as Record<string, unknown>
      : {};

    // 1. Resolve the caller. A missing/anon-key Authorization yields NO user,
    //    which is a legitimate state here (the guest booth) — unlike admin-api,
    //    where it is an immediate 401.
    let user: { id: string; email?: string | null } | null = null;
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const userClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
      );
      const { data } = await userClient.auth.getUser();
      if (data?.user) user = { id: data.user.id, email: data.user.email };
    }

    const sb = serviceClient();

    // 2. Platform-admin assert — BEFORE the dispatch switch, so a newly added
    //    admin action cannot forget its gate (admin-api's structural guard).
    if (ADMIN_ACTIONS.has(action)) {
      if (user === null) return json(401, { error: 'unauthorized' });
      const { data: adm, error: admErr } = await sb
        .from('platform_admins').select('user_id').eq('user_id', user.id).maybeSingle();
      if (admErr) throw admErr;
      if (!adm) return json(403, { error: 'forbidden' });
    }

    // 3. Dispatch.
    switch (action) {
      case 'create_ticket':
        return await createTicket(sb, args, user);
      case 'reply':
        if (user === null) return json(401, { error: 'unauthorized' });
        return await customerReply(sb, args, user);
      case 'my_counts':
        if (user === null) return json(401, { error: 'unauthorized' });
        return await myCounts(sb, user);

      case 'admin_list_tickets':
        return await adminListTickets(sb, args);
      case 'admin_get_ticket':
        return await adminGetTicket(sb, args);
      case 'admin_reply':
        return await adminReply(sb, args, user!.id, user!.email ?? null);
      case 'admin_set_status':
        return await adminPatch(sb, args, user!.id, 'status');
      case 'admin_set_priority':
        return await adminPatch(sb, args, user!.id, 'priority');
      case 'admin_assign':
        return await adminPatch(sb, args, user!.id, 'assigned_to');
      case 'admin_mark_read':
        return await adminMarkRead(sb, args);
      case 'admin_counts':
        return await adminCounts(sb);

      default:
        return json(400, { error: 'unknown_action' });
    }
  } catch (err) {
    console.error('[support-api] internal error', err);
    return json(500, { error: 'internal' });
  }
});
