/**
 * send-keepsakes — the post-event keepsake email.
 *
 * After the night is over a host sends every guest who opted in at the booth
 * one email: "the night in pictures", linking the public recap page at
 * `${PUBLIC_SITE_URL}/r/<slug>`. Consent rows live in `guest_contacts`
 * (migration 034); this function is their only reader.
 *
 * DEPLOY WITH verify_jwt OFF. That is not a relaxation — it is forced by the
 * unsubscribe link. A footer link in an email is fetched by a mail client with
 * no Authorization header and no apikey, so with verify_jwt ON the gateway
 * would reject it before a single line here ran, and the email would carry an
 * unsubscribe link that 401s. `validate-challenge-photo` and `stripe-webhook`
 * are already deployed this way for the same reason (no caller-side JWT).
 *
 * Because the gateway checks nothing, EVERY op authorizes itself, and the
 * authorization runs BEFORE the dispatch switch (admin-api's structural guard):
 *   send / preview — a real USER JWT (auth.getUser via an anon client carrying
 *                    the caller's Authorization header, card-publish's shape),
 *                    then org membership on the event, both resolved
 *                    server-side and never trusted from the body.
 *   unsub          — the unguessable `unsubscribe_token` uuid IS the
 *                    credential, and the reply is identical whether or not it
 *                    matched, so the endpoint is not a token oracle.
 *
 * GET  ?op=unsub&token=<uuid>       → 200 text/html, always.
 * POST { op: 'send',    eventUuid, resend?, collageUrl? }
 *        → { sent, skipped, failed, emailConfigured: true }
 *        The event must be 'ended' or 'archived' — mailing "relive the night"
 *        mid-party is worse than not sending at all. Contacts already stamped
 *        with `last_sent_at` are SKIPPED unless resend === true, and a whole
 *        run is refused when the event's most recent send is under 10 minutes
 *        old (again unless resend === true): a double-tapped button must not
 *        cost every guest a duplicate.
 * POST { op: 'preview', eventUuid, testEmail, collageUrl? }
 *        → { sent: 1, emailConfigured: true }
 *        One email to one address the caller names, for a member who wants to
 *        see the thing before it goes to the room. It NEVER reads or writes
 *        guest_contacts, works on an event of any status, and its footer says
 *        "preview" where the real send carries the unsubscribe link (there is
 *        no contact row, so there is no token to unsubscribe).
 *
 * 200 → see above          400 → { error: 'invalid_json' | 'invalid_body' | 'invalid_email' }
 * 401 → { error: 'unauthorized' }        403 → { error: 'forbidden' }
 * 404 → { error: 'event_not_found' }     405 → { error: 'method_not_allowed' }
 * 409 → { error: 'event_still_live' }    429 → { error: 'recently_sent' | 'preview_rate_limited' }
 * 500 → { error: 'internal' }            503 → { error: 'email_not_configured' }
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  // GET is listed because the unsubscribe link is a GET from a mail client.
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Pragmatic shape check, not RFC 5322 — the same rule card-publish applies
// (card-publish/index.ts:40) and the same one migration 034's CHECK enforces.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Hard ceiling on one run. Migration 034 caps a single event at 500 contacts,
 *  so this can only ever be reached by a schema drift, never by a real event —
 *  it exists so the loop is bounded by construction. */
const MAX_RECIPIENTS = 500;
/** A second send inside this window needs an explicit `resend: true`. */
const RESEND_COOLDOWN_MS = 10 * 60 * 1000;
/** Previews per member per event. See PREVIEW_HITS for what this does NOT do. */
const PREVIEW_MAX = 5;
const PREVIEW_WINDOW_MS = 60 * 60 * 1000;

/**
 * Preview rate limiting, in memory and deliberately so.
 *
 * A preview writes nothing, so there is no row to count and no honest place to
 * persist a marker without inventing schema for it. This Map bounds the
 * ACCIDENT — a host leaning on the button — inside one isolate.
 *
 * It is NOT a security control, and the comment says so rather than the code
 * implying otherwise: it resets on a cold start and each isolate keeps its own
 * copy, so a determined caller gets more than PREVIEW_MAX. What actually bounds
 * the abuse case is that every preview requires a real user JWT AND org
 * membership on the event, which is a signed-up, identifiable customer.
 */
const PREVIEW_HITS = new Map<string, number[]>();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function html(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Trusted config only. The request Origin is attacker-controllable and is
 *  deliberately NOT a source here (card-publish/index.ts:235-239). */
function siteBase(): string {
  return Deno.env.get('PUBLIC_SITE_URL')?.replace(/\/$/, '') || 'https://beamwall.app';
}

/** This function's own public URL. No sibling builds a self-URL, so there is no
 *  in-repo idiom to copy: `<project>/functions/v1/<name>` is Supabase's
 *  documented shape, derived from the SUPABASE_URL the runtime injects. */
function unsubUrlFor(token: string): string {
  const base = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '') ?? '';
  return `${base}/functions/v1/send-keepsakes?op=unsub&token=${encodeURIComponent(token)}`;
}

/* ------------------------------------------------------------------ */
/* The email                                                           */
/* ------------------------------------------------------------------ */

/**
 * One builder for both ops, so a preview cannot drift from the thing it is
 * previewing.
 *
 * Table-based with inline styles and no external CSS, fonts, script or
 * background image: Gmail strips <style> blocks in some clients and Outlook
 * renders through Word, so anything else is a coin toss. The background is
 * LIGHT — a dark email body is a spam-filter and a rendering risk, and this is
 * the one Beamwall surface that has to arrive in a stranger's inbox rather than
 * look like the product.
 *
 * `unsubUrl` null = preview: there is no contact row and therefore no token, so
 * the footer says what it is instead of showing a link that cannot work.
 *
 * `intro` = the host's keepsake line (events.config.copy.keepsakeIntro —
 * generated once by the AI copy mode, editable in Branding); null falls back
 * to the stock two-line intro so pre-copy events read exactly as before.
 */
function keepsakeEmailHtml(opts: {
  eventName: string;
  recapUrl: string;
  heroUrl: string | null;
  unsubUrl: string | null;
  intro: string | null;
}): string {
  const name = escapeHtml(opts.eventName);
  const recap = escapeHtml(opts.recapUrl);
  const hero = opts.heroUrl ? escapeHtml(opts.heroUrl) : null;
  const unsub = opts.unsubUrl ? escapeHtml(opts.unsubUrl) : null;
  const introHtml = opts.intro
    ? escapeHtml(opts.intro)
    : `The night in pictures — every photo from ${name}, in one place.<br />
                      Yours are in there. Have a look, and take home the ones you love.`;

  const heroRow = hero
    ? `<tr><td style="padding:0 0 28px;">
             <img src="${hero}" alt="" width="480" style="display:block;width:100%;max-width:480px;height:auto;border:0;border-radius:12px;" />
           </td></tr>`
    : '';

  const footerRow = unsub
    ? `<a href="${unsub}" style="color:#8a8378;text-decoration:underline;">Unsubscribe</a> from event emails.`
    : 'This is a preview — the real email carries an unsubscribe link.';

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f1ea;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f1ea;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:520px;">
            <tr>
              <td align="center" style="padding:0 0 24px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:#9a9284;">
                Beamwall
              </td>
            </tr>
            <tr>
              <td style="background:#ffffff;border-radius:18px;padding:36px 32px;text-align:center;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  ${heroRow}
                  <tr>
                    <td align="center" style="font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.3;color:#1d1a15;padding:0 0 14px;">
                      ${name}
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#5c564c;padding:0 0 28px;">
                      ${introHtml}
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:0 0 6px;">
                      <a href="${recap}" style="display:inline-block;background:#1d1a15;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;letter-spacing:0.14em;text-transform:uppercase;padding:16px 34px;border-radius:999px;">
                        See the photos
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:22px 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.7;color:#8a8378;">
                You gave us this address at the booth so we could send you the photos.<br />
                ${footerRow}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** POST one email to Resend. Returns true on a 2xx; logs and returns false
 *  otherwise, so one bad address cannot end a run. */
async function sendOne(
  apiKey: string,
  to: string,
  subject: string,
  body: string,
): Promise<boolean> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: Deno.env.get('KEEPSAKES_FROM_EMAIL') || 'Beamwall <photos@beamwall.app>',
        to,
        subject,
        html: body,
      }),
    });
    if (!res.ok) {
      console.error('[send-keepsakes] resend error', res.status, await res.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (e) {
    console.error('[send-keepsakes] resend threw', e);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Unsubscribe                                                         */
/* ------------------------------------------------------------------ */

const UNSUB_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Unsubscribed</title>
  </head>
  <body style="margin:0;background:#f4f1ea;font-family:Arial,Helvetica,sans-serif;color:#1d1a15;">
    <div style="max-width:420px;margin:0 auto;padding:88px 24px;text-align:center;">
      <p style="font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:#9a9284;margin:0 0 22px;">Beamwall</p>
      <h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:26px;margin:0 0 12px;">You're unsubscribed</h1>
      <p style="font-size:15px;line-height:1.6;color:#5c564c;margin:0;">This inbox won't get further event emails.</p>
    </div>
  </body>
</html>`;

/**
 * Always 200, always the same page.
 *
 * A token that does not exist, a token already used and a token that just
 * worked are indistinguishable from outside, so nobody can walk uuids to learn
 * which addresses we hold. There is nothing to gain from the true answer and
 * an enumeration oracle to lose.
 */
async function handleUnsub(token: string | null): Promise<Response> {
  if (token && UUID_RE.test(token)) {
    try {
      const sb = serviceClient();
      const { error } = await sb
        .from('guest_contacts')
        .update({ unsubscribed_at: new Date().toISOString() })
        .eq('unsubscribe_token', token)
        .is('unsubscribed_at', null);
      if (error) console.error('[send-keepsakes] unsub update failed', error);
    } catch (e) {
      // The page still renders. A guest who clicked unsubscribe and got an
      // error page would reasonably assume it did not work and escalate; the
      // honest recovery for a failed write is the retry they get from the next
      // email's link, not a scary page.
      console.error('[send-keepsakes] unsub threw', e);
    }
  }
  return html(200, UNSUB_PAGE);
}

/* ------------------------------------------------------------------ */
/* Entry                                                               */
/* ------------------------------------------------------------------ */

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // ── GET: the unsubscribe link only. Self-authorizing on the token. ──
  if (req.method === 'GET') {
    const url = new URL(req.url);
    if (url.searchParams.get('op') !== 'unsub') {
      return json(400, { error: 'invalid_body' });
    }
    return handleUnsub(url.searchParams.get('token'));
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
    /* ── Authorization, BEFORE the dispatch switch (admin-api's shape) ──
     * Both POST ops need the same three facts — a real user, a real event, and
     * membership between them — so they are established once, up front, and no
     * op can be added below that forgets one of them. */
    const op = body.op;
    if (op !== 'send' && op !== 'preview') {
      return json(400, { error: 'invalid_body' });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(401, { error: 'unauthorized' });
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    const user = userData?.user;
    // The anon key is itself a JWT and this function accepts unauthenticated
    // requests at the gateway, so "no user" is the ordinary signed-out case
    // rather than an exception — it must be answered, not thrown.
    if (userErr || !user) return json(401, { error: 'unauthorized' });

    const eventUuid = body.eventUuid;
    if (typeof eventUuid !== 'string' || !UUID_RE.test(eventUuid)) {
      return json(400, { error: 'invalid_body' });
    }

    const sb = serviceClient();
    const { data: event, error: evErr } = await sb
      .from('events')
      .select('id, org_id, slug, name, status, config')
      .eq('id', eventUuid)
      .maybeSingle();
    if (evErr) throw evErr;
    if (!event) return json(404, { error: 'event_not_found' });

    const { data: member, error: memErr } = await sb
      .from('org_members')
      .select('org_id')
      .eq('org_id', event.org_id as string)
      .eq('user_id', user.id)
      .maybeSingle();
    if (memErr) throw memErr;
    if (!member) return json(403, { error: 'forbidden' });

    // Shared inputs, validated once. `collageUrl` is only ever interpolated
    // into an <img src> — this function never fetches it — so https + a length
    // bound is the whole check; there is no SSRF surface to guard.
    const rawCollage = typeof body.collageUrl === 'string' ? body.collageUrl.trim() : '';
    const heroUrl =
      rawCollage.startsWith('https://') && rawCollage.length <= 500 ? rawCollage : null;
    const eventName = ((event.name as string | null) ?? '').trim() || 'our event';
    const recapUrl = `${siteBase()}/r/${event.slug}`;
    // The host's keepsake line (config.copy.keepsakeIntro — written once by
    // the AI copy mode, editable in Branding). Read from the row, never the
    // body; blank / non-string / over the 160-char client cap → the stock intro.
    const copyCfg = (event.config as { copy?: { keepsakeIntro?: unknown } } | null)?.copy;
    const rawIntro = copyCfg?.keepsakeIntro;
    const intro =
      typeof rawIntro === 'string' && rawIntro.trim() !== '' && rawIntro.length <= 160 ? rawIntro.trim() : null;

    /* ── op: preview ── */
    if (op === 'preview') {
      const testEmail = typeof body.testEmail === 'string' ? body.testEmail.trim() : '';
      if (!testEmail || testEmail.length > 320 || !EMAIL_RE.test(testEmail)) {
        return json(400, { error: 'invalid_email' });
      }

      const key = `${user.id}:${event.id}`;
      const now = Date.now();
      const hits = (PREVIEW_HITS.get(key) ?? []).filter((t) => now - t < PREVIEW_WINDOW_MS);
      if (hits.length >= PREVIEW_MAX) {
        return json(429, { error: 'preview_rate_limited' });
      }

      const resendKey = Deno.env.get('RESEND_API_KEY');
      if (!resendKey) return json(503, { error: 'email_not_configured' });

      const ok = await sendOne(
        resendKey,
        testEmail,
        `[Preview] Your photos from ${eventName}`,
        keepsakeEmailHtml({ eventName, recapUrl, heroUrl, unsubUrl: null, intro }),
      );
      if (!ok) return json(502, { error: 'email_failed' });

      hits.push(now);
      PREVIEW_HITS.set(key, hits);
      return json(200, { sent: 1, emailConfigured: true });
    }

    /* ── op: send ── */
    const status = (event.status as string | null) ?? '';
    if (status !== 'ended' && status !== 'archived') {
      return json(409, { error: 'event_still_live' });
    }

    const resend = body.resend === true;

    // 503 before ANY state change: a run that stamps last_sent_at and then
    // discovers it cannot send would leave every one of those guests
    // permanently skipped on the retry.
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) return json(503, { error: 'email_not_configured' });

    if (!resend) {
      const { data: latest, error: latestErr } = await sb
        .from('guest_contacts')
        .select('last_sent_at')
        .eq('event_id', event.slug as string)
        .not('last_sent_at', 'is', null)
        .order('last_sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestErr) throw latestErr;
      const lastSent = latest?.last_sent_at as string | null | undefined;
      if (lastSent && Date.now() - new Date(lastSent).getTime() < RESEND_COOLDOWN_MS) {
        return json(429, { error: 'recently_sent' });
      }
    }

    const { data: contacts, error: contactsErr } = await sb
      .from('guest_contacts')
      .select('id, email, unsubscribe_token, last_sent_at')
      .eq('event_id', event.slug as string)
      .is('unsubscribed_at', null)
      .order('created_at', { ascending: true })
      .limit(MAX_RECIPIENTS);
    if (contactsErr) throw contactsErr;

    const subject = `Your photos from ${eventName}`;
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const c of contacts ?? []) {
      // Already mailed for this event: skipped unless the caller explicitly
      // asked to send again. This is what makes the whole op re-runnable after
      // a partial failure without spamming the guests it already reached.
      if (!resend && c.last_sent_at !== null && c.last_sent_at !== undefined) {
        skipped += 1;
        continue;
      }
      try {
        const ok = await sendOne(
          resendKey,
          c.email as string,
          subject,
          keepsakeEmailHtml({
            eventName,
            recapUrl,
            heroUrl,
            unsubUrl: unsubUrlFor(c.unsubscribe_token as string),
            intro,
          }),
        );
        if (!ok) {
          failed += 1;
          continue;
        }
        // Stamped per contact, immediately — not batched at the end. If this
        // isolate dies mid-run, everyone already reached stays stamped and the
        // re-run skips them; a batched stamp would re-send to all of them.
        const { error: stampErr } = await sb
          .from('guest_contacts')
          .update({ last_sent_at: new Date().toISOString() })
          .eq('id', c.id as string);
        if (stampErr) {
          // The mail is gone; the stamp is not. Count it as sent (it was) and
          // log loudly — reporting a failure here would invite a re-run that
          // duplicates a delivered email.
          console.error('[send-keepsakes] stamp failed after send', c.id, stampErr);
        }
        sent += 1;
      } catch (e) {
        console.error('[send-keepsakes] contact failed', c.id, e);
        failed += 1;
      }
    }

    return json(200, { sent, skipped, failed, emailConfigured: true });
  } catch (err) {
    console.error('[send-keepsakes] internal error', err);
    return json(500, { error: 'internal' });
  }
});
