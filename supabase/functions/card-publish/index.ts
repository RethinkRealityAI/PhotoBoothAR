/**
 * card-publish — host-side card lifecycle: publish / unpublish / send email,
 * plus SCHEDULED delivery (migration 047).
 *
 * POST { cardId, action: 'publish' | 'unpublish' | 'send_email' }
 * POST { cardId, action: 'schedule', sendAt: ISO, timeZone?: IANA }
 * POST { cardId, action: 'unschedule' }
 *   Host actions require a real USER JWT in Authorization (resolved with
 *   auth.getUser below); membership is verified server-side via the card's
 *   org, never trusted from the body.
 * POST { action: 'deliver_due' }  + header x-cron-token
 *   The pg_cron job 'card-deliveries' (047). Authenticated by asking the
 *   database whether the presented token is the one it generated into Vault
 *   (card_delivery_token_ok) — no user, and no extra env secret here.
 *
 *   DEPLOY FILES: index.ts + email.ts + deno.json (email.ts is the template;
 *   leaving it out is an import error at boot, so every request 500s).
 *   NEEDS migration 049 (cards.presentation) live first: the host-action
 *   select names the column, so deploying before 049 makes every host action
 *   a 500. (The scheduled path reads `setof cards`, which picks the column up
 *   by itself.)
 *
 *   DEPLOY WITH verify_jwt OFF: the cron request carries no JWT, so the
 *   gateway check would reject it before this code runs. Every host action
 *   still authenticates itself (getUser), exactly as it did with the gateway
 *   check on — the gateway was a second copy of the same check.
 *
 * schedule  → needs a valid recipient_email and cardsStandard (it will
 *             publish); sendAt must be 1 min – 400 days out. Sets
 *             delivery_state 'scheduled'. At that moment deliver_due
 *             publishes the card (if still collecting) and emails it.
 * unschedule→ clears the schedule (a sent card keeps its delivered_at).
 *
 * publish   → server-side cardsStandard entitlement (event tier premium/deluxe,
 *             active org Pro subscription, or grandfathered legacy slug) else
 *             403 upgrade_required; sets status 'published' + published_at.
 * unpublish → back to status 'collecting' (published_at cleared).
 * send_email→ requires a published/rendered card + a valid recipient_email;
 *             sends via Resend (RESEND_API_KEY secret; absent → 503
 *             email_not_configured). From: CARDS_FROM_EMAIL (default
 *             'Beamwall <cards@beamwall.app>'); viewer link base:
 *             PUBLIC_SITE_URL (default: 'https://beamwall.app' — the
 *             attacker-controllable request Origin is deliberately NOT used).
 *
 * 200 → { card: { id, status, publishedAt, publicId } } | { sent: true }
 *       | { delivery: DeliveryView } (schedule / unschedule)
 *       | { claimed, sent, failed, retrying, waiting } (deliver_due — counts only)
 * 400 → { error: 'invalid_json' | 'invalid_body' | 'not_published' | 'invalid_recipient'
 *               | 'invalid_send_at' }
 * 401 → { error: 'unauthorized' }
 * 403 → { error: 'forbidden' | 'upgrade_required' }
 * 404 → { error: 'card_not_found' }
 * 409 → { error: 'delivery_in_progress' } (unschedule while a send is running)
 * 500 → { error: 'internal' }
 * 502 → { error: 'email_failed' }
 * 503 → { error: 'email_not_configured' }
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';
import {
  cardEmailHtml, cardEmailSubject, cardEmailText, summarizeContributions,
  type CardEmailInput, type ContributionRow, type EmailExtras,
} from './email.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Pragmatic shape check, not RFC 5322 — Resend enforces the rest.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* The cardsStandard tier set and the legacy-slug list used to live here as a
 * mirror of ENTITLEMENTS. public.resolve_features_raw (028) owns both now. */

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

/* ------------------------------------------------------------------ */
/* Shared by the manual send and the scheduled delivery                */
/* ------------------------------------------------------------------ */

// deno-lint-ignore no-explicit-any
type Sb = any;

interface CardForEmail {
  id: string;
  event_id: string;
  org_id: string;
  public_id: string;
  title: string;
  recipient_name: string | null;
  recipient_email: string | null;
  status: string;
  theme: unknown;
  /** Migration 049: { reveal, email, look }. email.ts normalises it, so a
   *  missing or junk value sends the default (glow) style. */
  presentation?: unknown;
}

/** Link base is trusted config only: PUBLIC_SITE_URL env, else a hardcoded
 *  fallback. The request Origin header is attacker-controllable and is
 *  deliberately NOT used as a source here. */
function siteUrl(): string {
  return Deno.env.get('PUBLIC_SITE_URL')?.replace(/\/$/, '') || 'https://beamwall.app';
}

function validRecipient(card: CardForEmail): string | null {
  const recipient = card.recipient_email?.trim() ?? '';
  return recipient && EMAIL_RE.test(recipient) ? recipient : null;
}

/** How long the photo links inside the email keep working. The email is a
 *  keepsake people reopen, and anyone holding it can already open the whole
 *  card by its link, so a long-lived photo link exposes nothing new. */
const EMAIL_PHOTO_TTL_S = 365 * 24 * 60 * 60;

/**
 * What the email shows from inside the card: counts, names, a quote and up to
 * four signed photo links. Uses the same visibility rule as card-view
 * (approved and not hidden). Any failure returns null, and the email falls
 * back to the plain version: a nicer email is never a reason not to send one.
 */
async function emailExtras(sb: Sb, cardId: string): Promise<EmailExtras | null> {
  try {
    const { data: rows, error } = await sb
      .from('card_contributions')
      .select('contributor_name, message, media_type, media_path')
      .eq('card_id', cardId)
      .eq('approved', true)
      .eq('hidden', false)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) {
      console.error('[card-publish] email contributions read failed', error);
      return null;
    }
    const summary = summarizeContributions((rows ?? []) as ContributionRow[]);
    const photoUrls: Record<string, string> = {};
    const paths = summary.photoPicks.map((p) => p.path);
    if (paths.length > 0) {
      const { data: signed, error: signErr } = await sb.storage
        .from('cards')
        .createSignedUrls(paths, EMAIL_PHOTO_TTL_S);
      if (signErr) console.error('[card-publish] email photo signing failed', signErr);
      for (const s of (signed ?? []) as { path: string | null; signedUrl: string | null }[]) {
        if (s.path && s.signedUrl) photoUrls[s.path] = s.signedUrl;
      }
    }
    return { summary, photoUrls };
  } catch (e) {
    console.error('[card-publish] email extras failed', e);
    return null;
  }
}

/**
 * One Resend send. `idempotencyKey` (scheduled path) makes a retry after a run
 * that died mid-send a no-op at Resend instead of a second email — Resend
 * honours the Idempotency-Key header on POST /emails for 24 hours.
 */
async function sendCardViaResend(
  sb: Sb,
  card: CardForEmail,
  recipient: string,
  resendKey: string,
  idempotencyKey?: string,
): Promise<{ ok: true } | { ok: false; status: number }> {
  const url = `${siteUrl()}/c/${card.public_id}`;
  const extras = await emailExtras(sb, card.id);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${resendKey}`,
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const email: CardEmailInput = {
    title: card.title,
    url,
    theme: card.theme,
    extras,
    presentation: card.presentation,
    recipientName: card.recipient_name,
  };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from: Deno.env.get('CARDS_FROM_EMAIL') || 'Beamwall <cards@beamwall.app>',
        to: recipient,
        subject: cardEmailSubject(card.title, extras?.summary ?? null),
        html: cardEmailHtml(email),
        text: cardEmailText(email),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      // Status + body only — never the recipient address (logs are visible to
      // anyone with dashboard access).
      console.error('[card-publish] resend error', res.status, await res.text().catch(() => ''));
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (e) {
    console.error('[card-publish] resend network error', e);
    return { ok: false, status: 0 };
  }
}

/**
 * Server-side cardsStandard entitlement, resolved by the DATABASE (migration
 * 028) rather than by a tier set in this file. The resolver reproduces all
 * three of the old rules — premium/deluxe event tier, an active org Pro
 * subscription (which raises the floor to premium, whose cardsStandard is
 * true), and the grandfathered legacy slugs — and adds the one this file could
 * never do: an operator comping the feature to a single customer from
 * /admin/features.
 *
 * 'unavailable' = the resolver errored. Callers fail CLOSED on it: the
 * resolver lives in the same Postgres as the write it guards.
 */
async function cardsStandardFor(sb: Sb, card: CardForEmail): Promise<'yes' | 'no' | 'unavailable'> {
  const { data: event, error: evErr } = await sb
    .from('events')
    .select('id, org_id, slug')
    .eq('slug', card.event_id)
    .maybeSingle();
  if (evErr) {
    console.error('[card-publish] event lookup failed', evErr);
    return 'unavailable';
  }
  const { data: features, error: featErr } = await sb.rpc('resolve_features_raw', {
    p_org: event?.org_id ?? card.org_id ?? null,
    p_event: event?.id ?? null,
  });
  if (featErr) {
    console.error('[card-publish] resolve_features_raw failed', featErr);
    return 'unavailable';
  }
  return (features as Record<string, unknown> | null)?.cardsStandard === true ? 'yes' : 'no';
}

/* ------------------------------------------------------------------ */
/* Scheduled delivery                                                  */
/* ------------------------------------------------------------------ */

const DELIVERY_COLUMNS =
  'deliver_at, deliver_time_zone, delivery_state, delivery_error, delivered_at, delivery_attempts';

/** Earliest / latest a host may schedule. */
const MIN_LEAD_MS = 60_000;
const MAX_LEAD_MS = 400 * 24 * 60 * 60 * 1000;
/** After this many failed sends the card stops retrying and shows "failed". */
const MAX_DELIVERY_ATTEMPTS = 5;
/** How long a card waits before re-checking when email is not configured. */
const NOT_CONFIGURED_RETRY_MS = 30 * 60 * 1000;

function validTimeZone(tz: unknown): string | null {
  if (typeof tz !== 'string' || !tz || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

function deliveryView(row: Record<string, unknown>) {
  return {
    deliverAt: (row.deliver_at as string | null) ?? null,
    deliverTimeZone: (row.deliver_time_zone as string | null) ?? null,
    deliveryState: (row.delivery_state as string | null) ?? null,
    deliveryError: (row.delivery_error as string | null) ?? null,
    deliveredAt: (row.delivered_at as string | null) ?? null,
  };
}

/** Exponential backoff for a failed send: 5, 10, 20, 40 minutes. */
function retryDelayMs(attempts: number): number {
  return 5 * 60_000 * 2 ** Math.max(0, Math.min(attempts - 1, 4));
}

type DeliverOutcome = 'sent' | 'failed' | 'retrying' | 'waiting';

/** Deliver ONE claimed card. Every write is guarded on delivery_state =
 *  'sending', so a host who unschedules mid-run is never overwritten. */
async function deliverOne(
  sb: Sb,
  card: CardForEmail & { deliver_at: string; delivery_attempts: number },
  resendKey: string | undefined,
): Promise<DeliverOutcome> {
  const now = Date.now();
  const settle = async (patch: Record<string, unknown>) => {
    const { error } = await sb.from('cards').update(patch).eq('id', card.id).eq('delivery_state', 'sending');
    if (error) console.error('[card-publish] deliver settle failed', card.id, error);
  };
  const retry = async (code: string): Promise<DeliverOutcome> => {
    if (card.delivery_attempts >= MAX_DELIVERY_ATTEMPTS) {
      await settle({ delivery_state: 'failed', delivery_error: code, delivery_retry_at: null });
      return 'failed';
    }
    await settle({
      delivery_state: 'scheduled',
      delivery_error: code,
      delivery_retry_at: new Date(now + retryDelayMs(card.delivery_attempts)).toISOString(),
    });
    return 'retrying';
  };

  // Email not switched on: keep the card scheduled and say why. Not counted as
  // an attempt, and the card is NOT published early — it should go out, all
  // at once, the moment email works.
  if (!resendKey) {
    await settle({
      delivery_state: 'scheduled',
      delivery_attempts: Math.max(0, card.delivery_attempts - 1),
      delivery_error: 'email_not_configured',
      delivery_retry_at: new Date(now + NOT_CONFIGURED_RETRY_MS).toISOString(),
    });
    return 'waiting';
  }

  const recipient = validRecipient(card);
  if (!recipient) {
    await settle({ delivery_state: 'failed', delivery_error: 'invalid_recipient', delivery_retry_at: null });
    return 'failed';
  }

  const ent = await cardsStandardFor(sb, card);
  if (ent === 'unavailable') return retry('features_unavailable');
  if (ent === 'no') {
    await settle({ delivery_state: 'failed', delivery_error: 'upgrade_required', delivery_retry_at: null });
    return 'failed';
  }

  // Publish first (closes contributions) so the link in the email opens.
  if (card.status === 'collecting') {
    const { error: pubErr } = await sb
      .from('cards')
      .update({ status: 'published', published_at: new Date(now).toISOString() })
      .eq('id', card.id)
      .eq('status', 'collecting');
    if (pubErr) {
      console.error('[card-publish] deliver publish failed', card.id, pubErr);
      return retry('publish_failed');
    }
  }

  const sent = await sendCardViaResend(
    sb,
    card,
    recipient,
    resendKey,
    `card-delivery-${card.id}-${Date.parse(card.deliver_at)}`,
  );
  if (sent.ok) {
    await settle({
      delivery_state: 'sent',
      delivered_at: new Date().toISOString(),
      delivery_error: null,
      delivery_retry_at: null,
    });
    return 'sent';
  }
  // A 4xx other than rate-limit / idempotency-in-flight will not get better by
  // retrying (e.g. Resend rejected the address) — stop and tell the host.
  if (sent.status >= 400 && sent.status < 500 && sent.status !== 429 && sent.status !== 409) {
    await settle({ delivery_state: 'failed', delivery_error: 'email_rejected', delivery_retry_at: null });
    return 'failed';
  }
  return retry('email_failed');
}

async function deliverDue(req: Request): Promise<Response> {
  const token = req.headers.get('x-cron-token') ?? '';
  if (token.length < 32) return json(401, { error: 'unauthorized' });
  const sb = serviceClient();
  const { data: ok, error: tokErr } = await sb.rpc('card_delivery_token_ok', { p_token: token });
  if (tokErr) {
    console.error('[card-publish] token check failed', tokErr);
    return json(503, { error: 'internal' });
  }
  if (ok !== true) return json(401, { error: 'unauthorized' });

  const { data: due, error: claimErr } = await sb.rpc('claim_due_card_deliveries', { p_limit: 20 });
  if (claimErr) {
    console.error('[card-publish] claim failed', claimErr);
    return json(500, { error: 'internal' });
  }
  const resendKey = Deno.env.get('RESEND_API_KEY') || undefined;
  const counts: Record<DeliverOutcome, number> = { sent: 0, failed: 0, retrying: 0, waiting: 0 };
  const rows = (due ?? []) as (CardForEmail & { deliver_at: string; delivery_attempts: number })[];
  for (const card of rows) {
    try {
      counts[await deliverOne(sb, card, resendKey)]++;
    } catch (e) {
      // Leave it 'sending' — the 10-minute lease brings it back.
      console.error('[card-publish] deliver crashed', card.id, e);
      counts.retrying++;
    }
  }
  // Counts only: no titles, names or addresses in the function log.
  console.log('[card-publish] deliver_due', JSON.stringify({ claimed: rows.length, ...counts }));
  return json(200, { claimed: rows.length, ...counts });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  try {
    // 0. The scheduler. Checked BEFORE the user gate because there is no user.
    if (body.action === 'deliver_due') return await deliverDue(req);

    // 1. Auth — resolve the caller from their JWT (user-scoped client).
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(401, { error: 'unauthorized' });
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    const user = userData?.user;
    if (userErr || !user) return json(401, { error: 'unauthorized' });

    // 2. Validate body.
    const { cardId, action } = body;
    if (typeof cardId !== 'string' || !UUID_RE.test(cardId)) {
      return json(400, { error: 'invalid_body' });
    }
    if (
      action !== 'publish' && action !== 'unpublish' && action !== 'send_email' &&
      action !== 'schedule' && action !== 'unschedule'
    ) {
      return json(400, { error: 'invalid_body' });
    }

    const sb = serviceClient();

    // 3. Card → event → org, then verify the caller's membership.
    const { data: card, error: cardErr } = await sb
      .from('cards')
      .select(`id, event_id, org_id, public_id, title, recipient_name, recipient_email, status, theme, presentation, ${DELIVERY_COLUMNS}`)
      .eq('id', cardId)
      .maybeSingle();
    if (cardErr) throw cardErr;
    if (!card) return json(404, { error: 'card_not_found' });

    const { data: member, error: memErr } = await sb
      .from('org_members')
      .select('org_id')
      .eq('org_id', card.org_id as string)
      .eq('user_id', user.id)
      .maybeSingle();
    if (memErr) throw memErr;
    if (!member) return json(403, { error: 'forbidden' });

    // 4. Actions.
    if (action === 'schedule') {
      const sendAtMs = typeof body.sendAt === 'string' ? Date.parse(body.sendAt) : NaN;
      const now = Date.now();
      if (!Number.isFinite(sendAtMs) || sendAtMs < now + MIN_LEAD_MS || sendAtMs > now + MAX_LEAD_MS) {
        return json(400, { error: 'invalid_send_at' });
      }
      if (!validRecipient(card as CardForEmail)) return json(400, { error: 'invalid_recipient' });
      // Delivery publishes the card, so it needs what Publish needs — checked
      // now so the host hears about it today, not silently on the birthday.
      const ent = await cardsStandardFor(sb, card as CardForEmail);
      if (ent === 'unavailable') return json(503, { error: 'features_unavailable' });
      if (ent === 'no') return json(403, { error: 'upgrade_required' });

      const { data: updated, error: updErr } = await sb
        .from('cards')
        .update({
          deliver_at: new Date(sendAtMs).toISOString(),
          deliver_time_zone: validTimeZone(body.timeZone),
          delivery_state: 'scheduled',
          delivery_attempts: 0,
          delivery_retry_at: null,
          delivery_error: null,
          delivered_at: null,
        })
        .eq('id', cardId)
        .select(DELIVERY_COLUMNS)
        .single();
      if (updErr) throw updErr;
      return json(200, { delivery: deliveryView(updated) });
    }

    if (action === 'unschedule') {
      // A card mid-send ('sending') is left alone: the email may already be on
      // its way, and pretending otherwise would be a lie in the host's UI.
      if (card.delivery_state === 'sending') return json(409, { error: 'delivery_in_progress' });
      const { data: updated, error: updErr } = await sb
        .from('cards')
        .update({
          deliver_at: null,
          deliver_time_zone: null,
          delivery_state: card.delivery_state === 'sent' ? 'sent' : null,
          delivery_attempts: 0,
          delivery_retry_at: null,
          delivery_error: null,
        })
        .eq('id', cardId)
        .select(DELIVERY_COLUMNS)
        .single();
      if (updErr) throw updErr;
      return json(200, { delivery: deliveryView(updated) });
    }

    if (action === 'publish') {
      // Fail CLOSED when the entitlement resolver is unreachable.
      const ent = await cardsStandardFor(sb, card as CardForEmail);
      if (ent === 'unavailable') return json(503, { error: 'features_unavailable' });
      if (ent === 'no') return json(403, { error: 'upgrade_required' });

      // Only stamp published_at on the collecting → published transition; when
      // re-publishing a card that was previously published/rendered, keep the
      // original published_at instead of clobbering it with a fresh timestamp.
      const publishPatch: Record<string, unknown> = { status: 'published' };
      if (card.status === 'collecting') {
        publishPatch.published_at = new Date().toISOString();
      }
      const { data: updated, error: updErr } = await sb
        .from('cards')
        .update(publishPatch)
        .eq('id', cardId)
        .select('id, status, published_at, public_id')
        .single();
      if (updErr) throw updErr;
      return json(200, {
        card: {
          id: updated.id,
          status: updated.status,
          publishedAt: updated.published_at,
          publicId: updated.public_id,
        },
      });
    }

    if (action === 'unpublish') {
      // Unpublish from published OR rendered → collecting. card_renders live in a
      // separate table and persist across this transition, so a rendered card is
      // not silently downgraded in a way that loses its rendered output — only the
      // public 'published' visibility is withdrawn.
      const { data: updated, error: updErr } = await sb
        .from('cards')
        .update({ status: 'collecting', published_at: null })
        .eq('id', cardId)
        .select('id, status, published_at, public_id')
        .single();
      if (updErr) throw updErr;
      return json(200, {
        card: {
          id: updated.id,
          status: updated.status,
          publishedAt: updated.published_at,
          publicId: updated.public_id,
        },
      });
    }

    // action === 'send_email'
    if (card.status !== 'published' && card.status !== 'rendered') {
      return json(400, { error: 'not_published' });
    }
    const recipient = validRecipient(card as CardForEmail);
    if (!recipient) return json(400, { error: 'invalid_recipient' });
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) return json(503, { error: 'email_not_configured' });

    const sent = await sendCardViaResend(sb, card as CardForEmail, recipient, resendKey);
    if (!sent.ok) return json(502, { error: 'email_failed' });

    // A manual send stands in for a pending schedule — the recipient must not
    // get the same card twice. (The host UI says so before they press it.)
    if (card.delivery_state === 'scheduled' || card.delivery_state === 'failed') {
      const { error: markErr } = await sb
        .from('cards')
        .update({
          delivery_state: 'sent',
          delivered_at: new Date().toISOString(),
          delivery_error: null,
          delivery_retry_at: null,
        })
        .eq('id', cardId)
        .in('delivery_state', ['scheduled', 'failed']);
      if (markErr) console.error('[card-publish] mark manual send failed', markErr);
    }
    return json(200, { sent: true });
  } catch (err) {
    console.error('[card-publish] internal error', err);
    return json(500, { error: 'internal' });
  }
});
