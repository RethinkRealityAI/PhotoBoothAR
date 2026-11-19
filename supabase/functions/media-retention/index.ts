/**
 * media-retention — enforces the retention every plan promises.
 *
 * POST {}            (deploy with verify_jwt OFF — called by pg_cron/pg_net,
 *                     which sends no user JWT; the shared secret below is the
 *                     whole authorization)
 * Header: x-retention-secret: <RETENTION_CRON_SECRET>
 *
 * 200 → { mode, now, checked, report: [{ slug, stage, deadline, action }] }
 * 401 → { error: 'unauthorized' }
 * 503 → { error: 'not_configured' }      RETENTION_CRON_SECRET unset
 * 500 → { error: 'internal' }
 *
 * MODES (secret RETENTION_ENFORCE):
 *   unset / 'off' → REPORT ONLY. Nothing is emailed, nothing is deleted.
 *   'notify'      → reminders are emailed; nothing is deleted.
 *   'purge'       → reminders AND removal.
 * The owner moves it off → notify → purge after reading the report.
 *
 * POLICY: src/lib/retention.ts, mirrored below (retention.test.ts holds the two
 * copies to the same constants). In short: the clock starts at the event's
 * end (else start, else creation), never before 2026-11-19; the host is
 * emailed RETENTION_NOTICE_DAYS before; nothing is removed without that
 * reminder having gone out at least that long ago; live events and the three
 * legacy slugs are never touched.
 *
 * WHAT IS REMOVED: guest captures only — `posts/<slug>/` in storage and the
 * event's `posts` rows (post_secrets cascade). The event, its frames and
 * assets, its keepsake cards and every business record stay. Objects are swept
 * FIRST and the rows deleted only when the sweep is clean (delete-event's
 * order), so a failed run leaves nothing orphaned and simply retries tomorrow.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

/* ── MIRRORS src/lib/retention.ts — keep identical (retention.test.ts) ── */
const RETENTION_NOTICE_DAYS = 14;
const RETENTION_POLICY_START = '2026-11-19T00:00:00Z';
const RETENTION_EXEMPT_SLUGS = ['hope-gala', 'jenna-jake', 'detola-wuyi'];
/* ─────────────────────────────────────────────────────────────────────── */

const DAY_MS = 24 * 60 * 60 * 1000;
const POSTS_BUCKET = 'posts';
const SAFE_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const LIST_PAGE = 1000;
const REMOVE_BATCH = 100;
const MAX_OBJECTS = 20_000;
const EVENT_PAGE = 500;
/** Bounded work per run so one invocation stays well inside the time limit;
 *  whatever is left is picked up by tomorrow's run. */
const MAX_PURGES_PER_RUN = 20;
const MAX_NOTICES_PER_RUN = 100;

type Mode = 'off' | 'notify' | 'purge';

interface Ev {
  id: string;
  slug: string;
  name: string | null;
  status: string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string | null;
  org_id: string | null;
}

interface Row {
  slug: string;
  stage: 'keep' | 'notify' | 'purge';
  deadline: string | null;
  action: string;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}
type Client = ReturnType<typeof serviceClient>;

/** Constant-time string compare, so the secret cannot be guessed by timing. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function readMode(): Mode {
  const v = (Deno.env.get('RETENTION_ENFORCE') ?? '').trim().toLowerCase();
  return v === 'notify' || v === 'purge' ? v : 'off';
}

/* ── Policy (MIRRORS retentionAnchor / retentionDeadline / retentionStage) ── */

function parse(iso: string | null | undefined): number | null {
  if (iso === null || iso === undefined || iso === '') return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function deadlineOf(ev: Ev, retentionDays: number | null): number | null {
  if (retentionDays === null || !Number.isFinite(retentionDays) || retentionDays <= 0) return null;
  const own = parse(ev.ends_at) ?? parse(ev.starts_at) ?? parse(ev.created_at);
  if (own === null) return null;
  return Math.max(own, Date.parse(RETENTION_POLICY_START)) + retentionDays * DAY_MS;
}

function stageOf(ev: Ev, retentionDays: number | null, noticeSentAt: string | null, now: number): Row['stage'] {
  if (RETENTION_EXEMPT_SLUGS.includes(ev.slug)) return 'keep';
  if ((ev.status ?? '').trim().toLowerCase() === 'live') return 'keep';
  const deadline = deadlineOf(ev, retentionDays);
  if (deadline === null) return 'keep';
  const notice = parse(noticeSentAt);
  if (notice === null) return now >= deadline - RETENTION_NOTICE_DAYS * DAY_MS ? 'notify' : 'keep';
  const purgeAt = Math.max(deadline, notice + RETENTION_NOTICE_DAYS * DAY_MS);
  return now >= purgeAt ? 'purge' : 'keep';
}

/* ── Storage sweep (same walk as delete-event) ── */

async function listAllKeys(sb: Client, prefix: string): Promise<string[]> {
  const root = prefix.replace(/\/+$/, '');
  if (!root) throw new Error('empty_prefix');
  const keys: string[] = [];
  const dirs: string[] = [root];
  while (dirs.length > 0) {
    const dir = dirs.pop() as string;
    let offset = 0;
    for (;;) {
      const { data, error } = await sb.storage.from(POSTS_BUCKET).list(dir, {
        limit: LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw error;
      const rows = data ?? [];
      for (const entry of rows) {
        const key = `${dir}/${entry.name}`;
        if (entry.id === null || entry.id === undefined) dirs.push(key);
        else keys.push(key);
      }
      if (keys.length > MAX_OBJECTS) throw new Error('too_many_objects');
      if (rows.length < LIST_PAGE) break;
      offset += rows.length;
    }
  }
  return keys;
}

async function purgeEvent(sb: Client, ev: Ev): Promise<{ objects: number; posts: number }> {
  if (!SAFE_SLUG_RE.test(ev.slug)) throw new Error('unsafe_slug');
  const keys = await listAllKeys(sb, ev.slug);
  for (let i = 0; i < keys.length; i += REMOVE_BATCH) {
    const { error } = await sb.storage.from(POSTS_BUCKET).remove(keys.slice(i, i + REMOVE_BATCH));
    if (error) throw error;
  }
  // Rows only after the sweep is clean. `posts.event_id` is the SLUG.
  const { data: gone, error } = await sb.from('posts').delete().eq('event_id', ev.slug).select('id');
  if (error) throw error;
  return { objects: keys.length, posts: gone?.length ?? 0 };
}

/* ── Reminder email ── */

function siteUrl(): string {
  return Deno.env.get('PUBLIC_SITE_URL')?.replace(/\/$/, '') || 'https://beamwall.app';
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function noticeHtml(eventName: string, removeOn: string, link: string): string {
  const name = esc(eventName);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;background:#f4f1ea;font-family:Arial,Helvetica,sans-serif;color:#1d1a15;">
  <div style="max-width:480px;margin:0 auto;padding:48px 24px;">
    <p style="font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:#9a9284;margin:0 0 22px;">Beamwall</p>
    <h1 style="font-size:22px;line-height:1.3;margin:0 0 14px;">Save your photos from ${name}</h1>
    <p style="font-size:15px;line-height:1.6;margin:0 0 22px;">Your plan keeps guest photos and videos until <strong>${esc(removeOn)}</strong>. After that they are removed for good. Download everything now and you keep them forever.</p>
    <p style="margin:0 0 28px;"><a href="${esc(link)}" style="display:inline-block;background:#1d1a15;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:999px;font-size:15px;">Download everything</a></p>
    <p style="font-size:13px;line-height:1.6;color:#6b645a;margin:0;">Need longer? Reply to this email and we will help.</p>
  </div>
</body></html>`;
}

async function sendNotice(apiKey: string, to: string, ev: Ev, removeOn: number): Promise<boolean> {
  const date = new Date(removeOn).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const link = `${siteUrl()}/host/events/${ev.id}`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: Deno.env.get('RETENTION_FROM_EMAIL') || Deno.env.get('KEEPSAKES_FROM_EMAIL') || 'Beamwall <photos@beamwall.app>',
        to,
        subject: `Save your photos from ${ev.name ?? 'your event'} before ${date}`,
        html: noticeHtml(ev.name ?? 'your event', date, link),
      }),
    });
    if (!res.ok) {
      console.error('[media-retention] resend error', res.status, await res.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (e) {
    console.error('[media-retention] resend threw', e);
    return false;
  }
}

async function ownerEmail(sb: Client, orgId: string | null): Promise<string | null> {
  if (!orgId) return null;
  const { data: org } = await sb.from('orgs').select('owner_id').eq('id', orgId).maybeSingle();
  const ownerId = (org as { owner_id?: string } | null)?.owner_id;
  if (!ownerId) return null;
  const { data, error } = await sb.auth.admin.getUserById(ownerId);
  if (error) return null;
  return data.user?.email ?? null;
}

async function stamp(sb: Client, eventId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await sb
    .from('event_retention')
    .upsert({ event_id: eventId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'event_id' });
  if (error) console.error('[media-retention] stamp failed', eventId, error);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const secret = Deno.env.get('RETENTION_CRON_SECRET') ?? '';
  if (secret.length < 16) return json(503, { error: 'not_configured' });
  if (!safeEqual(req.headers.get('x-retention-secret') ?? '', secret)) {
    return json(401, { error: 'unauthorized' });
  }

  try {
    const sb = serviceClient();
    const mode = readMode();
    const now = Date.now();
    const resendKey = Deno.env.get('RESEND_API_KEY') ?? '';

    const { data: ledgerRows, error: ledErr } = await sb
      .from('event_retention')
      .select('event_id, notice_sent_at, purged_at');
    if (ledErr) throw ledErr;
    const ledger = new Map<string, { notice_sent_at: string | null; purged_at: string | null }>();
    for (const r of ledgerRows ?? []) ledger.set(r.event_id as string, r as never);

    const report: Row[] = [];
    let purges = 0;
    let notices = 0;
    let checked = 0;

    for (let from = 0; ; from += EVENT_PAGE) {
      const { data: events, error } = await sb
        .from('events')
        .select('id, slug, name, status, starts_at, ends_at, created_at, org_id')
        .order('created_at', { ascending: true })
        .range(from, from + EVENT_PAGE - 1);
      if (error) throw error;
      const page = (events ?? []) as Ev[];

      for (const ev of page) {
        checked++;
        const led = ledger.get(ev.id);
        if (led?.purged_at) continue; // already done

        // The resolver is the authority for retention (plan → Pro → overrides).
        // A failed read KEEPS the media: deleting on a guess is unrecoverable.
        const { data: feat, error: featErr } = await sb.rpc('resolve_features_raw', {
          p_org: ev.org_id, p_event: ev.id,
        });
        if (featErr) {
          report.push({ slug: ev.slug, stage: 'keep', deadline: null, action: 'skipped: features_unavailable' });
          continue;
        }
        const raw = (feat as Record<string, unknown> | null)?.retentionDays;
        const days = typeof raw === 'number' ? raw : null;
        const deadline = deadlineOf(ev, days);
        const stage = stageOf(ev, days, led?.notice_sent_at ?? null, now);
        const row: Row = { slug: ev.slug, stage, deadline: deadline === null ? null : new Date(deadline).toISOString(), action: 'none' };

        if (stage === 'notify') {
          if (mode === 'off') row.action = 'would email reminder';
          else if (!resendKey) row.action = 'blocked: RESEND_API_KEY unset (purge waits)';
          else if (notices >= MAX_NOTICES_PER_RUN) row.action = 'deferred to next run';
          else {
            const to = await ownerEmail(sb, ev.org_id);
            if (!to) {
              row.action = 'blocked: no owner email (purge waits)';
              await stamp(sb, ev.id, { last_error: 'no_owner_email' });
            } else {
              // The purge date moves out to a full notice period after the
              // email ACTUALLY went out, so state that date, not the plan's.
              const removeOn = Math.max(deadline as number, now + RETENTION_NOTICE_DAYS * DAY_MS);
              const ok = await sendNotice(resendKey, to, ev, removeOn);
              notices++;
              if (ok) {
                await stamp(sb, ev.id, { notice_sent_at: new Date(now).toISOString(), notice_to: to, last_error: null });
                row.action = 'emailed reminder';
              } else {
                await stamp(sb, ev.id, { last_error: 'email_failed' });
                row.action = 'email failed (retry next run)';
              }
            }
          }
        } else if (stage === 'purge') {
          if (mode !== 'purge') row.action = 'would remove media';
          else if (purges >= MAX_PURGES_PER_RUN) row.action = 'deferred to next run';
          else {
            purges++;
            try {
              const r = await purgeEvent(sb, ev);
              await stamp(sb, ev.id, {
                purged_at: new Date().toISOString(), objects_removed: r.objects, posts_removed: r.posts, last_error: null,
              });
              row.action = `removed ${r.objects} files, ${r.posts} posts`;
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              console.error('[media-retention] purge failed', ev.slug, e);
              await stamp(sb, ev.id, { last_error: `purge_failed: ${msg}`.slice(0, 300) });
              row.action = 'purge failed (retry next run)';
            }
          }
        }
        if (stage !== 'keep' || row.action !== 'none') report.push(row);
      }
      if (page.length < EVENT_PAGE) break;
    }

    return json(200, { mode, now: new Date(now).toISOString(), checked, report });
  } catch (err) {
    console.error('[media-retention] internal error', err);
    return json(500, { error: 'internal' });
  }
});
