/**
 * card-render — Phase 6: kick off a premium MP4 "keepsake film" render of a
 * published greeting card via HeyGen HyperFrames.
 *
 * POST { cardId }
 *   (deployed with verify_jwt ON — requires a real USER JWT in Authorization,
 *    same auth pattern as card-publish; membership verified server-side via the
 *    card's org, never trusted from the body)
 *
 * Flow (mirrors ai-generate-image's spend-first / refund-on-failure model):
 *   auth → card → org membership → server-side cardsPremiumRender entitlement
 *   (event plan_tier 'deluxe' OR grandfathered legacy slug — a Pro subscription
 *   alone is NOT enough; the deluxe film is a per-event package) → card must be
 *   published/rendered → spend 30 credits (reason 'card_render', ref {card_id})
 *   → insert card_renders row (status 'queued', provider 'hyperframes',
 *   credits_charged 30) → branch on RENDER_BACKEND:
 *
 *     'hyperframes' → fetch the card + approved contributions the SAME way
 *        card-view does (service role, 24h-signed media URLs), build the film
 *        payload, and submit it to the HeyGen HyperFrames Cloud Render API with
 *        the payload injected as a render variable. Store the returned render id
 *        as render_id and set status 'rendering'. card-render-status then polls
 *        it, downloads the MP4, and marks the card 'rendered'.
 *        NOTE: the render backend RECEIVES the 24h-signed URLs of the card's
 *        photo/video contribution media — that is the only place guest media is
 *        sent, and it is required so the cloud renderer can fetch those frames.
 *
 *     disabled (DEFAULT — any RENDER_BACKEND value other than 'hyperframes',
 *        including unset) → immediately refund the 30 credits (grant_credits
 *        reason 'card_render_refund'), mark the card_renders row failed with
 *        error 'render_backend_disabled', return 503 render_not_configured.
 *        Credits are NEVER left spent when the backend is disabled.
 *
 * 200 → { render }                 card_renders row (queued|rendering)
 * 400 → { error: 'invalid_json' | 'invalid_body' }
 * 401 → { error: 'unauthorized' }
 * 402 → { error: 'insufficient_credits' }
 * 403 → { error: 'forbidden' | 'upgrade_required' }
 * 404 → { error: 'card_not_found' }
 * 409 → { error: 'card_not_published' }
 * 500 → { error: 'internal' }
 * 502 → { error: 'render_submit_failed' }   backend errored (credits refunded)
 * 503 → { error: 'render_not_configured' }  backend disabled / key missing (refunded)
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (injected);
 *      RENDER_BACKEND ('hyperframes' to enable; unset/anything-else = disabled);
 *      HEYGEN_HYPERFRAMES_API_KEY (secret), HEYGEN_HYPERFRAMES_API_URL
 *      (default 'https://api.heygen.com'), HEYGEN_HYPERFRAMES_ASSET_ID (the
 *      pre-uploaded keepsake-film composition bundle asset — one-time upload;
 *      see hyperframes/keepsake-film + the Phase 6 render setup notes).
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CARDS_BUCKET = 'cards';
const RENDER_COST = 30;
// Media URLs must stay valid through the render queue + the render itself, so
// they are signed for far longer than card-view's 1h viewer URLs.
const MEDIA_TTL_S = 60 * 60 * 24; // 24 hours
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** cardsPremiumRender is DELUXE-only (per-event) or a grandfathered legacy
 *  slug — mirror of ENTITLEMENTS in src/lib/entitlements.ts. Unlike
 *  cardsStandard, an org Pro subscription does NOT unlock it. */
const DELUXE_TIER = 'deluxe';
const LEGACY_SLUGS = new Set(['hope-gala', 'jenna-jake', 'detola-wuyi']);

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

/* ── Film payload (the keepsake-film composition's runtime input) ──────── */

interface FilmPayload {
  card: {
    title: string;
    recipientName: string | null;
    eventName: string | null;
    template: string;
    theme: Record<string, unknown>;
  };
  contributions: Array<{
    contributorName: string | null;
    message: string | null;
    mediaType: string | null;
    /** 24h-signed URL from the private 'cards' bucket; null for text. */
    url: string | null;
    durationSeconds: number | null;
  }>;
}

/**
 * Build the film payload exactly like the card-view edge fn assembles its
 * viewer response: approved + visible contributions, ordered, with batch-signed
 * media URLs (longer TTL here). This is the data the HyperFrames composition
 * renders into scenes.
 */
async function buildFilmPayload(sb: Client, cardId: string, eventSlug: string): Promise<FilmPayload> {
  const { data: card, error: cardErr } = await sb
    .from('cards')
    .select('title, recipient_name, template, theme')
    .eq('id', cardId)
    .single();
  if (cardErr) throw cardErr;

  const { data: event } = await sb.from('events').select('name').eq('slug', eventSlug).maybeSingle();

  const { data: rows, error: contribErr } = await sb
    .from('card_contributions')
    .select('contributor_name, message, media_type, media_path, duration_seconds, sort_order')
    .eq('card_id', cardId)
    .eq('approved', true)
    .eq('hidden', false)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (contribErr) throw contribErr;
  const contributions = rows ?? [];

  const paths = contributions
    .map((c) => c.media_path as string | null)
    .filter((p): p is string => Boolean(p));
  const urlByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed, error: signErr } = await sb.storage
      .from(CARDS_BUCKET)
      .createSignedUrls(paths, MEDIA_TTL_S);
    if (signErr) throw signErr;
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
    }
  }

  return {
    card: {
      title: (card.title as string) ?? 'A Card For You',
      recipientName: (card.recipient_name as string | null) ?? null,
      eventName: (event?.name as string | undefined) ?? null,
      template: (card.template as string) ?? 'storybook',
      theme: (card.theme as Record<string, unknown>) ?? {},
    },
    contributions: contributions.map((c) => ({
      contributorName: c.contributor_name as string | null,
      message: c.message as string | null,
      mediaType: c.media_type as string | null,
      url: c.media_path ? (urlByPath.get(c.media_path as string) ?? null) : null,
      durationSeconds: c.duration_seconds as number | null,
    })),
  };
}

/* ── HeyGen HyperFrames Cloud Render API client ───────────────────────────
 *
 * ⚠ ASSUMED CONTRACT — FLAGGED. HeyGen does not publish an openly-fetchable
 * REST reference for HyperFrames cloud rendering (developers.heygen.com is not
 * reachable from the build container; the GitHub repo documents only the local
 * CLI + AWS-Lambda self-host paths). The shape below is modelled on:
 *   • HeyGen's standard API auth convention (`x-api-key` header, base
 *     https://api.heygen.com), and
 *   • the public HyperFrames MCP render tools (`render_video` returns a render
 *     id; `get_render_status` returns render_status + a presigned `video_url`),
 *   • community-documented `POST /v3/hyperframes/renders` + `GET
 *     /v3/hyperframes/renders/{id}` endpoints.
 * Adjust the endpoint paths / field names in ONE place (here + the status fn)
 * once the official contract is confirmed. The composition + credit/refund
 * plumbing around it is contract-independent.
 *
 * The composition bundle (hyperframes/keepsake-film: index.html + gsap.min.js)
 * is uploaded to HeyGen ONCE out-of-band; its asset id is HEYGEN_HYPERFRAMES_
 * ASSET_ID. Each render references that asset + injects this card's data via the
 * `variables.payload` field — which the cloud/Lambda renderer exposes to the
 * composition as window.__hyperframes.getVariables().payload (the composition
 * reads it, falling back to a baked window.__KEEPSAKE_PAYLOAD__ global).
 */

interface HeygenSubmitResponse {
  render_id?: string;
  id?: string;
  data?: { render_id?: string; id?: string };
  status?: string;
}

/** Submit a render. Throws Error('render_not_configured') when secrets are
 *  missing; Error('heygen_http_<n>') / Error('heygen_no_render_id') otherwise. */
async function submitHyperframesRender(payload: FilmPayload): Promise<{ renderId: string }> {
  const key = Deno.env.get('HEYGEN_HYPERFRAMES_API_KEY');
  const assetId = Deno.env.get('HEYGEN_HYPERFRAMES_ASSET_ID');
  const base = (Deno.env.get('HEYGEN_HYPERFRAMES_API_URL') ?? 'https://api.heygen.com').replace(/\/$/, '');
  if (!key || !assetId) throw new Error('render_not_configured');

  const res = await fetch(`${base}/v3/hyperframes/renders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({
      project: { type: 'hyperframes', asset_id: assetId },
      composition: 'index.html',
      format: 'mp4',
      fps: 30,
      quality: 'high',
      resolution: '1080p',
      aspect_ratio: '16:9',
      title: `Keepsake film — ${payload.card.title}`,
      // The whole card payload as a single string variable (matches the
      // composition's declared `payload` variable).
      variables: { payload: JSON.stringify(payload) },
    }),
  });
  if (!res.ok) {
    console.error('[card-render] heygen submit error', res.status, await res.text().catch(() => ''));
    throw new Error(`heygen_http_${res.status}`);
  }
  const j = (await res.json()) as HeygenSubmitResponse;
  const id = j.render_id ?? j.id ?? j.data?.render_id ?? j.data?.id;
  if (!id) throw new Error('heygen_no_render_id');
  return { renderId: String(id) };
}

/* ── Refund helper — never leave credits spent on a non-started render ──── */

async function refund(sb: Client, orgId: string, cardId: string, renderId: string): Promise<void> {
  const { error } = await sb.rpc('grant_credits', {
    p_org: orgId,
    p_amount: RENDER_COST,
    p_reason: 'card_render_refund',
    p_ref: { card_id: cardId, render_id: renderId },
  });
  if (error) console.error('[card-render] REFUND FAILED', renderId, error);
}

/* ── Handler ──────────────────────────────────────────────────────────── */

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
    const { cardId } = body;
    if (typeof cardId !== 'string' || !UUID_RE.test(cardId)) {
      return json(400, { error: 'invalid_body' });
    }

    const sb = serviceClient();

    // 3. Card → event → org, then verify the caller's membership.
    const { data: card, error: cardErr } = await sb
      .from('cards')
      .select('id, event_id, org_id, status')
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

    // 4. Server-side cardsPremiumRender entitlement — DELUXE event tier or a
    //    grandfathered legacy slug ONLY. A Pro subscription alone does not
    //    unlock the deluxe film (per-event package), so — unlike card-publish —
    //    there is deliberately NO subscription fallback here.
    const { data: event, error: evErr } = await sb
      .from('events')
      .select('slug, plan_tier')
      .eq('slug', card.event_id as string)
      .maybeSingle();
    if (evErr) throw evErr;
    const allowed =
      (event?.plan_tier as string) === DELUXE_TIER || LEGACY_SLUGS.has(card.event_id as string);
    if (!allowed) return json(403, { error: 'upgrade_required' });

    // 5. The card must be published (or already rendered) before we film it.
    if (card.status !== 'published' && card.status !== 'rendered') {
      return json(409, { error: 'card_not_published' });
    }

    const orgId = card.org_id as string;

    // 6. Spend the render credits FIRST (atomic; raises 'insufficient_credits').
    const { error: spendErr } = await sb.rpc('spend_credits', {
      p_org: orgId,
      p_amount: RENDER_COST,
      p_reason: 'card_render',
      p_ref: { card_id: cardId },
    });
    if (spendErr) {
      if (String(spendErr.message ?? '').includes('insufficient_credits')) {
        return json(402, { error: 'insufficient_credits' });
      }
      throw spendErr;
    }

    // 7. Record the render (queued). If even this insert fails, refund directly.
    const { data: render, error: insErr } = await sb
      .from('card_renders')
      .insert({
        card_id: cardId,
        status: 'queued',
        provider: 'hyperframes',
        credits_charged: RENDER_COST,
      })
      .select()
      .single();
    if (insErr || !render) {
      const { error: rErr } = await sb.rpc('grant_credits', {
        p_org: orgId, p_amount: RENDER_COST, p_reason: 'card_render_refund', p_ref: { card_id: cardId },
      });
      if (rErr) console.error('[card-render] REFUND FAILED (insert)', rErr);
      throw insErr ?? new Error('render_insert_failed');
    }
    const renderId = render.id as string;

    // 8. Backend branch.
    const backend = Deno.env.get('RENDER_BACKEND') ?? '';

    if (backend !== 'hyperframes') {
      // DISABLED (default). Never leave credits spent.
      await refund(sb, orgId, cardId, renderId);
      const { data: failed } = await sb
        .from('card_renders')
        .update({ status: 'failed', error: 'render_backend_disabled', updated_at: new Date().toISOString() })
        .eq('id', renderId)
        .select()
        .single();
      return json(503, { error: 'render_not_configured', render: failed ?? render });
    }

    // 9. HyperFrames cloud submit. Everything after the spend refunds on failure.
    try {
      const payload = await buildFilmPayload(sb, card.id as string, card.event_id as string);
      const submit = await submitHyperframesRender(payload);
      const { data: updated, error: updErr } = await sb
        .from('card_renders')
        .update({ render_id: submit.renderId, status: 'rendering', updated_at: new Date().toISOString() })
        .eq('id', renderId)
        .select()
        .single();
      if (updErr) throw updErr;
      return json(200, { render: updated ?? render });
    } catch (err) {
      const notConfigured = err instanceof Error && err.message === 'render_not_configured';
      await refund(sb, orgId, cardId, renderId);
      const detail = err instanceof Error ? err.message : String(err);
      await sb
        .from('card_renders')
        .update({ status: 'failed', error: detail.slice(0, 500), updated_at: new Date().toISOString() })
        .eq('id', renderId);
      if (notConfigured) return json(503, { error: 'render_not_configured' });
      console.error('[card-render] submit failed', err);
      return json(502, { error: 'render_submit_failed' });
    }
  } catch (err) {
    console.error('[card-render] internal error', err);
    return json(500, { error: 'internal' });
  }
});
