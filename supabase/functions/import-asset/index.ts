/**
 * import-asset — bring an already-generated image INTO an event's library.
 *
 * A host who generated a frame or sticker somewhere else (their own Higgsfield
 * workspace, most likely) has a URL and no way to get it into the studio. This
 * fetches it server-side, proves it really is an image, re-hosts it in the
 * public assets bucket and creates the same unpublished `experiences` row that
 * ai-generate-image step 9 creates — so an imported asset behaves exactly like a
 * generated one everywhere downstream (library, publish, booth).
 *
 * NO CREDITS ARE INVOLVED. Nothing is spent, so there is no refund path and no
 * ai_jobs row: the host already paid whoever generated it.
 *
 * POST (deployed with verify_jwt ON — requires a real user JWT)
 *   { eventUuid: string,
 *     url: string,                              (https, publicly fetchable)
 *     kind: '2d_filter' | 'border',
 *     layout?: 'classic-border' | 'full-scene'  (border kind only; anything
 *            | 'duo-scene' | 'corner-overlay'    else is dropped rather than
 *            | 'bottom-third',                   rejected)
 *     name?: string }                           (≤40 chars, default
 *                                                'Imported asset')
 *   Fields may also arrive nested under `args`, for the house
 *   `{ action, args }` clients.
 *
 * 200 → { experience }   the unpublished experiences row
 * 400 → { error: 'invalid_json' | 'invalid_body' | 'invalid_url' |
 *                'invalid_asset' }
 * 401 → { error: 'unauthorized' }
 * 403 → { error: 'forbidden' }
 * 404 → { error: 'event_not_found' }
 * 413 → { error: 'asset_too_large' }
 * 500 → { error: 'internal' }
 * 502 → { error: 'fetch_failed' }   the source URL could not be read
 *
 * SSRF POSTURE (this function's whole risk surface — it fetches a URL a client
 * chose): https only, no IP literals, no localhost/link-local/internal hosts,
 * `redirect: 'error'` so a 302 cannot walk the request somewhere the checks
 * already refused, a content-type that must start image/, a 10MB ceiling
 * enforced against BOTH the declared length and the real bytes, and magic-byte
 * verification of PNG / JPEG / WebP. A declared content-type is a claim; the
 * magic bytes are the evidence.
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (injected).
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ASSETS_BUCKET = 'assets';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same two kinds ai-generate-image accepts. */
const KINDS = new Set(['2d_filter', 'border']);

/** The five frame archetypes. MIRROR of FRAME_LAYOUT_SPEC's keys in
 *  ai-generate-image/index.ts and FrameLayout in src/lib/assetPrompt.ts — edge
 *  functions cannot import from src/, so the list is carried, not shared. */
const LAYOUTS = new Set([
  'classic-border', 'full-scene', 'duo-scene', 'corner-overlay', 'bottom-third',
]);

/** 10MB, the same ceiling fetchReferenceInline uses in ai-generate-image. A
 *  frame is a 1080×1920 PNG; anything past this is not one. */
const MAX_BYTES = 10 * 1024 * 1024;

/** Max experience name, matching nameFromPrompt in ai-generate-image. */
const NAME_MAX = 40;
const DEFAULT_NAME = 'Imported asset';

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

/**
 * Cheap alpha probe: PNG signature + IHDR color type only (no full decode).
 * Color type 4 (gray+alpha) or 6 (RGBA) carry an alpha channel. Anything that
 * isn't decodable as a PNG header is treated as opaque.
 * (Copied from ai-generate-image — edge fns cannot import from each other.)
 */
function pngHasAlpha(bytes: Uint8Array): boolean {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 26) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIG[i]) return false;
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return false;
  }
  const colorType = bytes[25];
  return colorType === 4 || colorType === 6;
}

interface ImageFormat {
  ext: 'png' | 'jpg' | 'webp';
  contentType: string;
}

/**
 * Identify the format from the BYTES, not from the server's content-type claim.
 * Returns null for anything that is not one of the three formats the booth can
 * composite — an SVG, an HTML error page served as image/png, or a renamed zip
 * all land here.
 */
function sniffImage(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length < 16) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { ext: 'png', contentType: 'image/png' };
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return { ext: 'jpg', contentType: 'image/jpeg' };
  }
  // WebP: 'RIFF' ....  'WEBP'
  const riff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  const webp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (riff && webp) return { ext: 'webp', contentType: 'image/webp' };
  return null;
}

/**
 * An IP literal in any of the spellings a URL host can take. The test is the
 * FINAL LABEL, not a dotted-quad pattern: a real hostname's last label is
 * alphabetic, while every IP spelling — dotted decimal (127.0.0.1), a bare
 * integer (2130706433), hex (0x7f000001) — ends in digits or 0x-hex. IPv6 is
 * caught by the colon, which URL.hostname keeps inside its brackets.
 */
function isIpLiteral(host: string): boolean {
  if (host.includes(':')) return true;
  const labels = host.split('.');
  const last = labels[labels.length - 1] ?? '';
  return /^[0-9]+$/.test(last) || /^0x[0-9a-f]+$/i.test(last);
}

/** Hosts that must never be fetched even over https — the loopback and
 *  cloud-metadata names that resolve INSIDE the runtime's network. */
const BLOCKED_HOST_SUFFIXES = ['localhost', '.localhost', '.local', '.internal', '.localdomain'];

/**
 * Validate the client-chosen URL before any network call. Returns the parsed
 * URL or null. Everything here is refused rather than repaired: a URL we had to
 * fix up is a URL we did not understand.
 */
function safeSourceUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if (!host) return null;
  if (isIpLiteral(host)) return null;
  if (host === 'localhost') return null;
  if (BLOCKED_HOST_SUFFIXES.some((s) => s.startsWith('.') ? host.endsWith(s) : host === s)) return null;
  // Credentials in a URL are only ever an attempt to confuse a fetcher.
  if (u.username || u.password) return null;
  return u;
}

/** Trim a host-supplied name to the same ≤40 chars the generated rows use. */
function assetName(v: unknown): string {
  if (typeof v !== 'string') return DEFAULT_NAME;
  const clean = v.trim().replace(/\s+/g, ' ');
  if (!clean) return DEFAULT_NAME;
  return clean.length <= NAME_MAX ? clean : `${clean.slice(0, NAME_MAX - 1)}…`;
}

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
    // Accept a flat body and the house `{ action, args }` shape alike.
    const nested = (body.args !== null && typeof body.args === 'object' && !Array.isArray(body.args))
      ? body.args as Record<string, unknown>
      : {};
    const args: Record<string, unknown> = { ...body, ...nested };

    // 1. Auth — resolve the caller from their JWT (ai-generate-image's pattern).
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

    // 2. Validate the body.
    const eventUuid = typeof args.eventUuid === 'string' ? args.eventUuid.trim() : '';
    if (!eventUuid || !UUID_RE.test(eventUuid)) return json(400, { error: 'invalid_body' });
    const kind = typeof args.kind === 'string' ? args.kind : '';
    if (!KINDS.has(kind)) return json(400, { error: 'invalid_body' });
    const rawUrl = typeof args.url === 'string' ? args.url.trim() : '';
    if (!rawUrl || rawUrl.length > 2048) return json(400, { error: 'invalid_body' });
    const source = safeSourceUrl(rawUrl);
    if (!source) return json(400, { error: 'invalid_url' });
    // A layout only means something for a border. A bad one is DROPPED rather
    // than rejected: the import still produces a usable frame, and the studio
    // already treats a missing layout as 'classic-border'.
    const layoutRaw = typeof args.layout === 'string' ? args.layout : '';
    const layout = kind === 'border' && LAYOUTS.has(layoutRaw) ? layoutRaw : null;
    const name = assetName(args.name);

    const sb = serviceClient();

    // 3. Event + org membership (ai-generate-image step 3, same query).
    const { data: event, error: evErr } = await sb
      .from('events')
      .select('id, slug, org_id')
      .eq('id', eventUuid)
      .maybeSingle();
    if (evErr) throw evErr;
    if (!event) return json(404, { error: 'event_not_found' });
    const orgId = event.org_id as string;
    const eventSlug = event.slug as string;

    const { data: member, error: memErr } = await sb
      .from('org_members')
      .select('org_id')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (memErr) throw memErr;
    if (!member) return json(403, { error: 'forbidden' });

    // 4. Fetch the source. `redirect: 'error'` is load-bearing: without it a
    //    302 from an allowed host to http://169.254.169.254 would sail past
    //    every check above, because those checks only ever saw the first URL.
    let res: Response;
    try {
      res = await fetch(source.toString(), {
        redirect: 'error',
        headers: { Accept: 'image/*' },
      });
    } catch (e) {
      console.warn('[import-asset] fetch error', e instanceof Error ? e.message : 'unknown');
      return json(502, { error: 'fetch_failed' });
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      console.warn('[import-asset] source not ok', res.status);
      return json(502, { error: 'fetch_failed' });
    }
    const declaredType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!declaredType.startsWith('image/')) {
      await res.body?.cancel().catch(() => {});
      console.warn('[import-asset] source not an image', declaredType);
      return json(400, { error: 'invalid_asset' });
    }
    // Cheap pre-check on the declared length so a 2GB body is refused before it
    // is read. Compared to null explicitly — a legitimate 0 would be caught by
    // the byte check below, and a missing header is not a 0.
    const declaredLen = res.headers.get('content-length');
    if (declaredLen !== null && Number(declaredLen) > MAX_BYTES) {
      await res.body?.cancel().catch(() => {});
      return json(413, { error: 'asset_too_large' });
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0) return json(400, { error: 'invalid_asset' });
    if (bytes.length > MAX_BYTES) return json(413, { error: 'asset_too_large' });

    // 5. The evidence, not the claim: magic bytes decide the format. No
    //    re-encode — the bytes are stored exactly as the provider produced
    //    them, so nothing here can degrade the artwork.
    const format = sniffImage(bytes);
    if (!format) {
      console.warn('[import-asset] magic bytes rejected', declaredType, bytes.length);
      return json(400, { error: 'invalid_asset' });
    }

    // 6. Re-host in the public assets bucket. A random name, never anything
    //    derived from the source URL: the path is public, and a host-controlled
    //    path segment is a way to overwrite someone else's object.
    const path = `${eventSlug}/imports/${crypto.randomUUID()}.${format.ext}`;
    const { error: upErr } = await sb.storage
      .from(ASSETS_BUCKET)
      .upload(path, bytes, { contentType: format.contentType, upsert: false });
    if (upErr) throw upErr;
    const { data: pub } = sb.storage.from(ASSETS_BUCKET).getPublicUrl(path);
    const assetUrl = pub.publicUrl;

    // 7. The same unpublished experiences row ai-generate-image step 9 writes,
    //    so an imported asset is indistinguishable downstream except for
    //    `config.imported`.
    const { data: experience, error: expErr } = await sb
      .from('experiences')
      .insert({
        // events.slug, NOT the uuid — experiences.event_id is the SLUG (the
        // documented key trap: event_plans keys on the uuid, this does not).
        event_id: eventSlug,
        org_id: orgId,
        name,
        kind,
        asset_url: assetUrl,
        thumbnail_url: assetUrl,
        config: {
          generated: true,
          imported: true,
          provider: 'higgsfield',
          transparent: pngHasAlpha(bytes),
          ...(layout ? { layout } : {}),
          transform: { scale: 1, x: 0, y: 0, rotation: 0 },
          opacity: 1,
        },
        is_published: false,
        featured: false,
        sort_order: 0,
        source: 'ai_higgsfield',
      })
      .select()
      .single();
    if (expErr || !experience) {
      // The object is already in the bucket; leaving it there orphaned is worse
      // than a best-effort cleanup, and a failed cleanup changes nothing.
      const { error: rmErr } = await sb.storage.from(ASSETS_BUCKET).remove([path]);
      if (rmErr) console.error('[import-asset] orphan cleanup failed', path, rmErr.message);
      throw expErr ?? new Error('experience_insert_failed');
    }

    return json(200, { experience });
  } catch (err) {
    console.error('[import-asset] internal error', err);
    return json(500, { error: 'internal' });
  }
});
