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
 *
 * ── THE NEXT-DAY AUTOPILOT (migration 045) ──────────────────────────────────
 * Two more POST ops, called ONLY by the keepsake worker (scripts/keepsake-
 * worker.mjs, run on a schedule by .github/workflows/keepsake-films.yml). They
 * authorize on a shared secret in the `x-keepsake-worker` header, compared in
 * constant time against KEEPSAKE_WORKER_SECRET, BEFORE their dispatch — the
 * same structural guard as the user ops. The worker holds no Supabase key:
 * it can ask what is due, upload to the two signed URLs it is handed, and
 * report back. Everything else (who to mail, what to write, the entitlement)
 * stays here.
 *
 *   POST { op: 'due' }
 *     → { items: [{ eventUuid, slug, film: { payload, upload } | null }] }
 *     Claims up to MAX_DUE_PER_RUN events whose next-morning time has come
 *     (autopilot.ts has the rule) by inserting their keepsake_runs row — the
 *     primary key is the lock. `film` is null when the event is on a free
 *     plan or has too few photos; the worker then finishes it straight away.
 *     Refuses with 503 BEFORE claiming anything when email is not configured,
 *     so a missing key can never burn an event's one claim.
 *   POST { op: 'finish', eventUuid, result: 'ready' | 'failed' | 'skipped', error? }
 *     → { sent, skipped, failed, film: 'ready' | 'failed' | 'skipped' }
 *     Verifies a 'ready' film really is in storage, then mails every opted-in
 *     guest who has not had the keepsake yet — WITH the film when there is
 *     one, and always with the album. A film that failed never holds the
 *     email back: the guest gets the photos either way.
 *   401 → { error: 'unauthorized' }  409 → { error: 'not_claimed' }
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';
import {
  FILM_MIN_PHOTOS,
  MAX_DUE_PER_RUN,
  NEXT_MORNING_OFFSET_MS,
  AFTER_END_DELAY_MS,
  MAX_LATE_MS,
  buildEventFilmPayload,
  reclaimMode,
  filmEntitled,
  filmPaths,
  isKeepsakeDue,
  pickFilmPhotos,
  workerAuthorized,
  type FilmPost,
} from './autopilot.ts';

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
  /** The film's poster frame. Present only when the event has a ready film —
   *  the hero then IS the film's thumbnail and both it and the button open the
   *  album at the film. */
  filmPosterUrl?: string | null;
}): string {
  const name = escapeHtml(opts.eventName);
  const film = opts.filmPosterUrl ? escapeHtml(opts.filmPosterUrl) : null;
  const recap = escapeHtml(film ? `${opts.recapUrl}#film` : opts.recapUrl);
  const hero = film ?? (opts.heroUrl ? escapeHtml(opts.heroUrl) : null);
  const unsub = opts.unsubUrl ? escapeHtml(opts.unsubUrl) : null;
  const introHtml = opts.intro
    ? escapeHtml(opts.intro)
    : film
      ? `We made a short film of ${name}, from the photos taken at the booth.<br />
                      It's waiting for you with every photo from the night. Yours are in there.`
      : `The night in pictures — every photo from ${name}, in one place.<br />
                      Yours are in there. Have a look, and take home the ones you love.`;
  const ctaLabel = film ? 'Watch the film' : 'See the photos';

  // A poster gets a play badge laid over it, made of a table cell rather than
  // an image or a background (both are stripped by some clients), so it reads
  // as "this is a video" everywhere.
  const heroRow = film
    ? `<tr><td style="padding:0 0 28px;">
             <a href="${recap}" style="display:block;text-decoration:none;">
               <img src="${film}" alt="Play the film of ${name}" width="480" style="display:block;width:100%;max-width:480px;height:auto;border:0;border-radius:12px;" />
             </a>
             <p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#9a9284;">&#9654;&nbsp; Your film of the night</p>
           </td></tr>`
    : hero
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
                        ${ctaLabel}
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
    /* ── The autopilot's worker ops: shared-secret auth, BEFORE their dispatch ──
     * Never reachable with a user JWT, and the user ops below are never
     * reachable with the worker secret: the two credentials open disjoint
     * doors. */
    if (body.op === 'due' || body.op === 'finish') {
      if (!workerAuthorized(req.headers.get('x-keepsake-worker'), Deno.env.get('KEEPSAKE_WORKER_SECRET'))) {
        return json(401, { error: 'unauthorized' });
      }
      const sb = serviceClient();
      return body.op === 'due' ? await handleDue(sb) : await handleFinish(sb, body);
    }

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

    const result = await sendToContacts(sb, resendKey, {
      slug: event.slug as string,
      subject: `Your photos from ${eventName}`,
      resend,
      build: (unsubUrl) => keepsakeEmailHtml({ eventName, recapUrl, heroUrl, unsubUrl, intro }),
    });
    return json(200, { ...result, emailConfigured: true });
  } catch (err) {
    console.error('[send-keepsakes] internal error', err);
    return json(500, { error: 'internal' });
  }
});

/* ------------------------------------------------------------------ */
/* The send loop — shared by the host's button and the autopilot       */
/* ------------------------------------------------------------------ */

type Service = ReturnType<typeof serviceClient>;

async function sendToContacts(
  sb: Service,
  resendKey: string,
  opts: { slug: string; subject: string; resend: boolean; build: (unsubUrl: string) => string },
): Promise<{ sent: number; skipped: number; failed: number }> {
  const { data: contacts, error: contactsErr } = await sb
    .from('guest_contacts')
    .select('id, email, unsubscribe_token, last_sent_at')
    .eq('event_id', opts.slug)
    .is('unsubscribed_at', null)
    .order('created_at', { ascending: true })
    .limit(MAX_RECIPIENTS);
  if (contactsErr) throw contactsErr;

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const c of contacts ?? []) {
    // Already mailed for this event: skipped unless the caller explicitly
    // asked to send again. This is what makes the whole op re-runnable after
    // a partial failure without spamming the guests it already reached — and
    // it is why the autopilot never re-mails a guest the host already reached
    // with the button.
    if (!opts.resend && c.last_sent_at !== null && c.last_sent_at !== undefined) {
      skipped += 1;
      continue;
    }
    try {
      const ok = await sendOne(
        resendKey,
        c.email as string,
        opts.subject,
        opts.build(unsubUrlFor(c.unsubscribe_token as string)),
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

  return { sent, skipped, failed };
}

/* ------------------------------------------------------------------ */
/* The next-day autopilot — worker ops (see the header)                */
/* ------------------------------------------------------------------ */

const POSTS_BUCKET = 'posts';

interface DueEvent {
  id: string;
  org_id: string | null;
  slug: string;
  name: string | null;
  status: string | null;
  starts_at: string | null;
  ended_at: string | null;
  config: unknown;
}

function accentOf(config: unknown): string | null {
  const hexes = (config as { accentHexes?: unknown } | null)?.accentHexes;
  return Array.isArray(hexes) && typeof hexes[0] === 'string' ? hexes[0] : null;
}

function introOf(config: unknown): string | null {
  const raw = (config as { copy?: { keepsakeIntro?: unknown } } | null)?.copy?.keepsakeIntro;
  return typeof raw === 'string' && raw.trim() !== '' && raw.length <= 160 ? raw.trim() : null;
}

/**
 * The film job for one claimed event, or null when it gets no film: a free
 * plan, an unreachable entitlement answer (closed — the email still goes), or
 * fewer than FILM_MIN_PHOTOS stills. The worker receives the photos' PUBLIC
 * urls (the posts bucket is public — the wall shows them to anyone) and two
 * signed upload urls scoped to exactly this event's film and poster paths.
 */
async function prepareFilm(sb: Service, ev: DueEvent) {
  const { data: features, error: featErr } = await sb.rpc('resolve_features_raw', {
    p_org: ev.org_id,
    p_event: ev.id,
  });
  if (featErr) {
    console.error('[send-keepsakes] autopilot: resolve_features_raw failed', ev.slug, featErr);
    return null;
  }
  if (!filmEntitled(features)) return null;

  const { data: rows, error: postsErr } = await sb
    .from('posts')
    .select('id, image_url, media_type, guest_name, message, created_at')
    .eq('event_id', ev.slug)
    .eq('approved', true)
    .eq('hidden', false)
    .order('created_at', { ascending: true })
    .limit(1000);
  if (postsErr) throw postsErr;
  const stills = pickFilmPhotos((rows ?? []) as FilmPost[], Number.MAX_SAFE_INTEGER);
  if (stills.length < FILM_MIN_PHOTOS) return null;

  const payload = buildEventFilmPayload({
    eventName: (ev.name ?? '').trim() || 'Our event',
    accent: accentOf(ev.config),
    photos: pickFilmPhotos(stills),
    totalPhotos: stills.length,
  });

  const paths = filmPaths(ev.slug);
  const bucket = sb.storage.from(POSTS_BUCKET);
  const [film, poster] = await Promise.all([
    bucket.createSignedUploadUrl(paths.film, { upsert: true }),
    bucket.createSignedUploadUrl(paths.poster, { upsert: true }),
  ]);
  if (film.error || poster.error || !film.data || !poster.data) {
    throw film.error ?? poster.error ?? new Error('signed_upload_failed');
  }
  return {
    payload,
    upload: {
      film: { path: paths.film, signedUrl: film.data.signedUrl },
      poster: { path: paths.poster, signedUrl: poster.data.signedUrl },
    },
  };
}

async function handleDue(sb: Service): Promise<Response> {
  // Checked BEFORE any claim: a claim is an event's one shot at its next-day
  // email, and a missing key would spend it on nothing.
  if (!Deno.env.get('RESEND_API_KEY')) return json(503, { error: 'email_not_configured' });

  const now = Date.now();
  const sinceDate = new Date(now - NEXT_MORNING_OFFSET_MS - MAX_LATE_MS).toISOString();
  const sinceEnd = new Date(now - AFTER_END_DELAY_MS - MAX_LATE_MS).toISOString();
  const { data: events, error: evErr } = await sb
    .from('events')
    .select('id, org_id, slug, name, status, starts_at, ended_at, config')
    .in('status', ['live', 'ended', 'archived'])
    .or(`starts_at.gte.${sinceDate},ended_at.gte.${sinceEnd}`)
    .limit(500);
  if (evErr) throw evErr;

  const due = ((events ?? []) as DueEvent[]).filter((e) => isKeepsakeDue(e, now));
  if (due.length === 0) return json(200, { items: [] });

  const { data: runs, error: runsErr } = await sb
    .from('keepsake_runs')
    .select('event_id, status, attempts, claimed_at')
    .in('event_id', due.map((e) => e.slug));
  if (runsErr) throw runsErr;
  const runBy = new Map((runs ?? []).map((r) => [r.event_id as string, r]));

  const items: Array<{ eventUuid: string; slug: string; film: Awaited<ReturnType<typeof prepareFilm>> }> = [];
  for (const ev of due) {
    if (items.length >= MAX_DUE_PER_RUN) break;
    const existing = runBy.get(ev.slug);
    let mode: 'film' | 'email_only' | null = null;

    if (!existing) {
      // The primary key is the lock: of two overlapping runs, exactly one
      // insert returns a row.
      const { data, error } = await sb
        .from('keepsake_runs')
        .upsert({ event_id: ev.slug }, { onConflict: 'event_id', ignoreDuplicates: true })
        .select('event_id');
      if (error) {
        console.error('[send-keepsakes] autopilot: claim failed', ev.slug, error);
        continue;
      }
      if ((data ?? []).length === 1) mode = 'film';
    } else {
      const want = reclaimMode(
        { status: existing.status as string, attempts: existing.attempts as number, claimed_at: existing.claimed_at as string },
        now,
      );
      if (want !== null) {
        // Optimistic: only the run that still sees the same attempt count wins.
        const { data, error } = await sb
          .from('keepsake_runs')
          .update({
            attempts: (existing.attempts as number) + 1,
            claimed_at: new Date(now).toISOString(),
            film_status: 'pending',
            error: null,
          })
          .eq('event_id', ev.slug)
          .eq('status', 'claimed')
          .eq('attempts', existing.attempts as number)
          .select('event_id');
        if (!error && (data ?? []).length === 1) mode = want;
      }
    }
    if (mode === null) continue;

    let film: Awaited<ReturnType<typeof prepareFilm>> = null;
    if (mode === 'film') {
      try {
        film = await prepareFilm(sb, ev);
      } catch (e) {
        // No film is a smaller loss than no email: the item still goes out.
        console.error('[send-keepsakes] autopilot: prepareFilm failed', ev.slug, e);
        film = null;
      }
    }
    items.push({ eventUuid: ev.id, slug: ev.slug, film });
  }

  return json(200, { items });
}

async function handleFinish(sb: Service, body: Record<string, unknown>): Promise<Response> {
  const eventUuid = body.eventUuid;
  const result = body.result;
  if (typeof eventUuid !== 'string' || !UUID_RE.test(eventUuid)) return json(400, { error: 'invalid_body' });
  if (result !== 'ready' && result !== 'failed' && result !== 'skipped') return json(400, { error: 'invalid_body' });
  const reported = typeof body.error === 'string' ? body.error.slice(0, 500) : null;

  const { data: event, error: evErr } = await sb
    .from('events')
    .select('id, slug, name, config')
    .eq('id', eventUuid)
    .maybeSingle();
  if (evErr) throw evErr;
  if (!event) return json(404, { error: 'event_not_found' });
  const slug = event.slug as string;

  const { data: run, error: runErr } = await sb
    .from('keepsake_runs')
    .select('status')
    .eq('event_id', slug)
    .maybeSingle();
  if (runErr) throw runErr;
  // Only an open claim can be finished — a replayed or late finish must not
  // mail anyone twice (the per-contact stamps would skip them anyway; this
  // also keeps the run's numbers honest).
  if (!run || run.status !== 'claimed') return json(409, { error: 'not_claimed' });

  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) return json(503, { error: 'email_not_configured' });

  // A 'ready' claim is checked, not believed: both files must be in storage.
  const paths = filmPaths(slug);
  let filmStatus: 'ready' | 'failed' | 'skipped' = result;
  let error: string | null = result === 'failed' ? (reported ?? 'render_failed') : null;
  if (result === 'ready') {
    const { data: files, error: listErr } = await sb.storage.from(POSTS_BUCKET).list(`${slug}/_film`);
    const names = new Set((files ?? []).map((f) => f.name));
    if (listErr || !names.has('keepsake.mp4') || !names.has('poster.jpg')) {
      filmStatus = 'failed';
      error = 'film_missing_after_upload';
    }
  }
  const posterUrl =
    filmStatus === 'ready' ? sb.storage.from(POSTS_BUCKET).getPublicUrl(paths.poster).data.publicUrl : null;

  const { error: markErr } = await sb
    .from('keepsake_runs')
    .update({
      film_status: filmStatus,
      film_path: filmStatus === 'ready' ? paths.film : null,
      poster_path: filmStatus === 'ready' ? paths.poster : null,
      error,
    })
    .eq('event_id', slug);
  if (markErr) throw markErr;

  const eventName = ((event.name as string | null) ?? '').trim() || 'our event';
  const recapUrl = `${siteBase()}/r/${slug}`;
  const intro = introOf(event.config);
  // If this throws, the run stays 'claimed': a later run reclaims it once it
  // goes stale and the per-contact stamps make that re-send skip everyone
  // already reached.
  const counts = await sendToContacts(sb, resendKey, {
    slug,
    subject: posterUrl ? `Your film from ${eventName} is ready` : `Your photos from ${eventName}`,
    resend: false,
    build: (unsubUrl) =>
      keepsakeEmailHtml({ eventName, recapUrl, heroUrl: null, unsubUrl, intro, filmPosterUrl: posterUrl }),
  });

  const { error: doneErr } = await sb
    .from('keepsake_runs')
    .update({ status: 'done', finished_at: new Date().toISOString(), sent: counts.sent, failed: counts.failed })
    .eq('event_id', slug);
  if (doneErr) console.error('[send-keepsakes] autopilot: done stamp failed', slug, doneErr);

  return json(200, { ...counts, film: filmStatus });
}
