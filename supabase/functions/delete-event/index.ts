/**
 * delete-event — permanent, host-initiated deletion of an ARCHIVED event.
 *
 * POST { eventUuid, confirmName }
 *   (deploy with verify_jwt ON — requires a real user JWT in Authorization)
 *
 * 200 → { deleted: true,  objectsRemoved }               everything is gone
 * 200 → { deleted: false, partial: true, remaining[], objectsRemoved }
 *                                                       storage sweep incomplete;
 *                                                       the event row still EXISTS
 * 400 → { error: 'invalid_json' | 'invalid_body' | 'name_mismatch' }
 * 401 → { error: 'unauthorized' }
 * 403 → { error: 'forbidden' | 'must_archive_first' }
 * 404 → { error: 'not_found' }
 * 500 → { error: 'internal' }
 *
 * WHY THIS FUNCTION EXISTS. Deleting the row is not the hard part — a host could
 * already do that with the anon key (`events_member_delete`, migration 003), and
 * every dependent ROW takes care of itself: verified against the live catalog,
 * all 13 FKs to public.events are declared. posts, cards, challenges,
 * app_settings, experiences, event_catalog_links and guest_quota CASCADE from
 * events.slug; event_plans, event_access_tokens and event_feature_overrides
 * CASCADE from events.id; ai_jobs, orders and support_tickets SET NULL because
 * they are business records that outlive the event.
 *
 * STORAGE DOES NOT CASCADE. A Postgres foreign key cannot reach storage.objects,
 * so a client-side delete leaves every capture, uploaded asset, keepsake-card
 * media file and rendered film in the buckets forever, with no row left pointing
 * at them — unfindable, unbillable, and still publicly readable in the two public
 * buckets. So: sweep the buckets FIRST, delete the row LAST, and if the sweep
 * could not finish, delete NOTHING and say which prefixes are left. A host who
 * retries lands on the same idempotent sweep (already-removed objects simply
 * stop being listed); a host who never retries still has an intact event.
 *
 * Object layouts swept (all written by the sibling functions in this directory):
 *   posts    <slug>/<sessionId>/<uuid>.<ext>     submit-post          (public)
 *   assets   <slug>/{ai,imports,uploads}/…       ai-gen, import-asset  (public)
 *   cards    <slug>/<cardId>/<uuid>.<ext>        card-contribute      (private)
 *   renders  <cardId>/<renderId>.mp4             card-render-status   (private)
 * The renders bucket is keyed on the CARD id, not the slug, so the card ids are
 * read out of the table BEFORE the row delete cascades them away.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Mirrors create-event's SLUG_RE plus the three coded legacy slugs. A slug is
 *  a storage PREFIX here, so anything with a '/' or a '.' in it is refused
 *  rather than swept — the blast radius of a wrong prefix is a whole bucket. */
const SAFE_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

/** Buckets whose objects live under `<slug>/`. */
const SLUG_BUCKETS = ['posts', 'assets', 'cards'];
const RENDERS_BUCKET = 'renders';

/** Storage list() caps at 1000 rows per call. */
const LIST_PAGE = 1000;
/** Keys per remove() call — one request body, kept well inside any URL/body cap. */
const REMOVE_BATCH = 100;
/** Refuse to sweep an unbounded tree in one request: past this the function
 *  reports the prefix as remaining (row kept) instead of timing out mid-delete. */
const MAX_OBJECTS = 20_000;
const CARD_PAGE = 1000;
const MAX_CARDS = 5_000;

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

type Client = ReturnType<typeof serviceClient>;

/**
 * Type-to-confirm gate. MIRRORS `confirmNameMatches` in src/lib/eventArchive.ts
 * (tested in eventArchive.test.ts) — Deno cannot import from src/, so that test
 * file is the contract both halves are written against. Trim both sides,
 * case-SENSITIVE, and an empty target can never be confirmed.
 */
function confirmMatches(typed: unknown, actual: unknown): boolean {
  const a = typeof typed === 'string' ? typed.trim() : '';
  const b = typeof actual === 'string' ? actual.trim() : '';
  return a.length > 0 && a === b;
}

/**
 * Every object key under `prefix`, recursively.
 *
 * storage.list() is NOT recursive: it returns one directory level, where a
 * FOLDER entry is distinguished by a null `id` (files carry an id and metadata).
 * So this walks a stack of directories, paging each one past the 1000-row cap.
 * Throws 'too_many_objects' rather than looping forever on a pathological tree.
 */
async function listAllKeys(sb: Client, bucket: string, prefix: string): Promise<string[]> {
  const root = prefix.replace(/\/+$/, '');
  if (!root) throw new Error('empty_prefix'); // never list a bucket root
  const keys: string[] = [];
  const dirs: string[] = [root];
  while (dirs.length > 0) {
    const dir = dirs.pop() as string;
    let offset = 0;
    for (;;) {
      const { data, error } = await sb.storage.from(bucket).list(dir, {
        limit: LIST_PAGE,
        offset,
        // Stable order: offset paging over an unsorted listing can skip rows.
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw error;
      const rows = data ?? [];
      for (const entry of rows) {
        const key = `${dir}/${entry.name}`;
        // Folder rows have no id (and no metadata) — recurse into them.
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

/** Remove every key in batches. Throws on the first storage error. */
async function removeAll(sb: Client, bucket: string, keys: string[]): Promise<number> {
  let removed = 0;
  for (let i = 0; i < keys.length; i += REMOVE_BATCH) {
    const batch = keys.slice(i, i + REMOVE_BATCH);
    const { error } = await sb.storage.from(bucket).remove(batch);
    if (error) throw error;
    removed += batch.length;
  }
  return removed;
}

/** One bucket prefix, listed then removed. Null means "this prefix is not clean". */
async function sweepPrefix(sb: Client, bucket: string, prefix: string): Promise<number | null> {
  try {
    const keys = await listAllKeys(sb, bucket, prefix);
    if (keys.length === 0) return 0;
    return await removeAll(sb, bucket, keys);
  } catch (err) {
    console.error(`[delete-event] sweep failed ${bucket}/${prefix}`, err);
    return null;
  }
}

/** Every card id for this event slug, paged. Read BEFORE the row delete, because
 *  the renders bucket is keyed on the card id and cards CASCADE away with it. */
async function cardIdsForEvent(sb: Client, slug: string): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; from < MAX_CARDS; from += CARD_PAGE) {
    const { data, error } = await sb
      .from('cards')
      .select('id')
      .eq('event_id', slug)
      .order('created_at', { ascending: true })
      .range(from, from + CARD_PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const row of rows) ids.push(row.id as string);
    if (rows.length < CARD_PAGE) break;
  }
  return ids;
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
    // 1. Auth — the caller comes from their verified JWT, never from the body.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(401, { error: 'unauthorized' });
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    const user = userData?.user;
    if (userErr || !user) return json(401, { error: 'unauthorized' });

    const { eventUuid, confirmName } = body;
    if (typeof eventUuid !== 'string' || !UUID_RE.test(eventUuid)) {
      return json(400, { error: 'invalid_body' });
    }

    const sb = serviceClient();

    // 2. The event, read server-side: the name typed below is checked against
    //    the ROW's name, so a caller cannot supply both halves of the gate.
    const { data: event, error: evErr } = await sb
      .from('events')
      .select('id, slug, name, status, org_id')
      .eq('id', eventUuid)
      .maybeSingle();
    if (evErr) throw evErr;
    if (!event) return json(404, { error: 'not_found' });

    // 3. Tenancy — membership of the event's OWN org (never the caller's first
    //    membership, which would delete across tenants for a multi-org user).
    const { data: membership, error: memErr } = await sb
      .from('org_members')
      .select('user_id')
      .eq('org_id', event.org_id as string)
      .eq('user_id', user.id)
      .maybeSingle();
    if (memErr) throw memErr;
    if (!membership) return json(403, { error: 'forbidden' });

    // 4. Archived only. Archiving is the reversible step; this one is not, and
    //    two deliberate acts is the whole safety model. Mirrors canDeleteStatus
    //    in src/lib/eventArchive.ts.
    if ((event.status as string ?? '').trim().toLowerCase() !== 'archived') {
      return json(403, { error: 'must_archive_first' });
    }

    // 5. Type-to-confirm.
    if (!confirmMatches(confirmName, event.name)) {
      return json(400, { error: 'name_mismatch' });
    }

    const slug = event.slug as string;
    if (!SAFE_SLUG_RE.test(slug)) {
      // Refuse rather than sweep a prefix we cannot reason about.
      console.error('[delete-event] refusing unsafe slug', slug);
      return json(400, { error: 'invalid_body' });
    }

    // 6. Storage sweep. Card ids first — they are the renders bucket's keys and
    //    the row delete will cascade the cards away.
    const cardIds = await cardIdsForEvent(sb, slug);

    let objectsRemoved = 0;
    const remaining: string[] = [];

    for (const bucket of SLUG_BUCKETS) {
      const n = await sweepPrefix(sb, bucket, slug);
      if (n === null) remaining.push(`${bucket}/${slug}/`);
      else objectsRemoved += n;
    }
    for (const cardId of cardIds) {
      if (!UUID_RE.test(cardId)) {
        remaining.push(`${RENDERS_BUCKET}/${cardId}/`);
        continue;
      }
      const n = await sweepPrefix(sb, RENDERS_BUCKET, cardId);
      if (n === null) remaining.push(`${RENDERS_BUCKET}/${cardId}/`);
      else objectsRemoved += n;
    }

    // 7. NOTHING is deleted while media is still out there. The host keeps an
    //    intact archived event and can retry; the alternative — a deleted row
    //    over orphaned public objects — is unrecoverable by any UI we ship.
    if (remaining.length > 0) {
      return json(200, { deleted: false, partial: true, remaining, objectsRemoved });
    }

    // 8. The row, last. Zero rows is not success (an UPDATE/DELETE that matches
    //    nothing returns no error at all — the lesson host.ts's updateEventStatus
    //    already carries), so the affected ids are asked for explicitly.
    const { data: gone, error: delErr } = await sb
      .from('events')
      .delete()
      .eq('id', eventUuid)
      .select('id');
    if (delErr) throw delErr;
    if ((gone?.length ?? 0) === 0) return json(404, { error: 'not_found' });

    return json(200, { deleted: true, objectsRemoved });
  } catch (err) {
    console.error('[delete-event] internal error', err);
    return json(500, { error: 'internal' });
  }
});
