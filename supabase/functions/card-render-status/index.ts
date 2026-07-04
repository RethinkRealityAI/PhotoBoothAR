/**
 * card-render-status — Phase 6: poll a keepsake-film render and, on completion,
 * copy the finished MP4 into the private 'renders' bucket.
 *
 * POST { renderId }
 *   (deployed with verify_jwt ON — requires a real USER JWT; membership is
 *    verified server-side via render → card → org, never trusted from the body)
 *
 * Returns the card_renders row, plus a fresh 1h signed download URL for the MP4
 * whenever the render has an output_path (the private 'renders' bucket has no
 * member-read RLS policy, so the client cannot sign it directly — this
 * service-role fn does it after verifying membership). When the row is a
 * HyperFrames render still in flight (provider 'hyperframes', status
 * 'rendering'), this polls the HeyGen HyperFrames render-status endpoint and
 * reconciles:
 *   • completed → download the MP4 from HeyGen's presigned URL, upload it to the
 *       private 'renders' bucket at `${cardId}/${renderId}.mp4`, set the row's
 *       output_path + status 'done', and flip the card to status 'rendered'.
 *   • failed    → mark the row failed and refund the 30 credits (grant_credits
 *       reason 'card_render_refund'). Guarded so concurrent polls refund once.
 *   • still rendering → return the row unchanged.
 * Rows from a disabled backend (already 'failed') or a non-hyperframes provider
 * are returned as-is.
 *
 * 200 → { render, downloadUrl }    render row + 1h signed MP4 URL (null if none)
 * 400 → { error: 'invalid_json' | 'invalid_body' }
 * 401 → { error: 'unauthorized' }
 * 403 → { error: 'forbidden' }
 * 404 → { error: 'render_not_found' }
 * 500 → { error: 'internal' }
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (injected);
 *      HEYGEN_HYPERFRAMES_API_KEY (secret), HEYGEN_HYPERFRAMES_API_URL
 *      (default 'https://api.heygen.com').
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RENDERS_BUCKET = 'renders';
const RENDER_COST = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/* ── HeyGen HyperFrames render-status client ──────────────────────────────
 *
 * ⚠ ASSUMED CONTRACT — FLAGGED (see card-render/index.ts for the full rationale
 * and sources). Poll: GET {base}/v3/hyperframes/renders/{render_id} with the
 * `x-api-key` header; response carries a status (pending|rendering|completed|
 * failed, terminology may vary) and, once done, a presigned `video_url`. Adjust
 * the endpoint / field names here + in card-render if the official contract
 * differs; the reconciliation logic around it is contract-independent.
 */

type RenderPhase = 'rendering' | 'completed' | 'failed';

interface HeygenStatusResponse {
  status?: string;
  render_status?: string;
  data?: { status?: string; render_status?: string; video_url?: string; output_url?: string };
  video_url?: string;
  output_url?: string;
  error?: string;
}

function normalizePhase(raw: string | undefined): RenderPhase {
  const s = (raw ?? '').toLowerCase();
  if (['completed', 'complete', 'done', 'success', 'succeeded', 'finished'].includes(s)) return 'completed';
  if (['failed', 'failure', 'error', 'errored', 'canceled', 'cancelled'].includes(s)) return 'failed';
  return 'rendering'; // pending / processing / queued / rendering / unknown
}

async function pollHyperframesRender(
  renderId: string,
): Promise<{ phase: RenderPhase; videoUrl: string | null }> {
  const key = Deno.env.get('HEYGEN_HYPERFRAMES_API_KEY');
  const base = (Deno.env.get('HEYGEN_HYPERFRAMES_API_URL') ?? 'https://api.heygen.com').replace(/\/$/, '');
  if (!key) throw new Error('render_not_configured');

  const res = await fetch(`${base}/v3/hyperframes/renders/${encodeURIComponent(renderId)}`, {
    headers: { 'x-api-key': key },
  });
  if (!res.ok) {
    console.error('[card-render-status] heygen poll error', res.status, await res.text().catch(() => ''));
    throw new Error(`heygen_http_${res.status}`);
  }
  const j = (await res.json()) as HeygenStatusResponse;
  const phase = normalizePhase(j.status ?? j.render_status ?? j.data?.status ?? j.data?.render_status);
  const videoUrl = j.video_url ?? j.output_url ?? j.data?.video_url ?? j.data?.output_url ?? null;
  return { phase, videoUrl };
}

async function refund(sb: Client, orgId: string, cardId: string, renderId: string): Promise<void> {
  const { error } = await sb.rpc('grant_credits', {
    p_org: orgId,
    p_amount: RENDER_COST,
    p_reason: 'card_render_refund',
    p_ref: { card_id: cardId, render_id: renderId },
  });
  if (error) console.error('[card-render-status] REFUND FAILED', renderId, error);
}

const DOWNLOAD_TTL_S = 60 * 60; // 1h signed MP4 link

/** 200 response = the row + a fresh signed MP4 URL (when it has an output_path).
 *  Signing is done service-role here because members can't read the private
 *  'renders' bucket directly (no member-read policy on that bucket). */
async function respond(sb: Client, render: Record<string, unknown>): Promise<Response> {
  let downloadUrl: string | null = null;
  const path = (render.output_path as string | null) ?? null;
  if (path) {
    const { data, error } = await sb.storage.from(RENDERS_BUCKET).createSignedUrl(path, DOWNLOAD_TTL_S);
    if (error) console.warn('[card-render-status] sign download failed', error);
    else downloadUrl = data?.signedUrl ?? null;
  }
  return json(200, { render, downloadUrl });
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
    // 1. Auth.
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

    // 2. Validate.
    const { renderId } = body;
    if (typeof renderId !== 'string' || !UUID_RE.test(renderId)) {
      return json(400, { error: 'invalid_body' });
    }

    const sb = serviceClient();

    // 3. Render → card → org, then verify the caller's membership.
    const { data: render, error: rErr } = await sb
      .from('card_renders')
      .select('id, card_id, status, provider, render_id, output_path, error, credits_charged, created_at, updated_at')
      .eq('id', renderId)
      .maybeSingle();
    if (rErr) throw rErr;
    if (!render) return json(404, { error: 'render_not_found' });

    const { data: card, error: cardErr } = await sb
      .from('cards')
      .select('id, org_id, status')
      .eq('id', render.card_id as string)
      .maybeSingle();
    if (cardErr) throw cardErr;
    if (!card) return json(404, { error: 'render_not_found' });

    const { data: member, error: memErr } = await sb
      .from('org_members')
      .select('org_id')
      .eq('org_id', card.org_id as string)
      .eq('user_id', user.id)
      .maybeSingle();
    if (memErr) throw memErr;
    if (!member) return json(403, { error: 'forbidden' });

    // 4. Only actively poll HyperFrames renders that are still in flight.
    const isHyperframes = render.provider === 'hyperframes';
    const inFlight = render.status === 'rendering' && Boolean(render.render_id);
    if (!isHyperframes || !inFlight) {
      return await respond(sb, render);
    }

    let poll: { phase: RenderPhase; videoUrl: string | null };
    try {
      poll = await pollHyperframesRender(render.render_id as string);
    } catch (err) {
      // Poll failure is transient (network / config) — keep the row 'rendering'
      // and let the client retry. Do NOT refund on a transient poll error.
      console.error('[card-render-status] poll error (kept rendering)', err);
      return await respond(sb, render);
    }

    if (poll.phase === 'rendering') {
      return await respond(sb, render);
    }

    if (poll.phase === 'failed') {
      // Guarded transition so concurrent polls refund exactly once.
      const { data: failed } = await sb
        .from('card_renders')
        .update({ status: 'failed', error: 'render_failed', updated_at: new Date().toISOString() })
        .eq('id', renderId)
        .eq('status', 'rendering')
        .select()
        .maybeSingle();
      if (failed) await refund(sb, card.org_id as string, card.id as string, renderId);
      return await respond(sb, failed ?? { ...render, status: 'failed', error: 'render_failed' });
    }

    // poll.phase === 'completed'
    if (!poll.videoUrl) {
      // Completed but no URL yet — treat as still rendering, retry next poll.
      return await respond(sb, render);
    }
    const dl = await fetch(poll.videoUrl);
    if (!dl.ok) {
      console.error('[card-render-status] mp4 download failed', dl.status);
      return await respond(sb, render); // retry next poll
    }
    const bytes = new Uint8Array(await dl.arrayBuffer());
    const outputPath = `${card.id}/${renderId}.mp4`;
    const { error: upErr } = await sb.storage
      .from(RENDERS_BUCKET)
      .upload(outputPath, bytes, { contentType: 'video/mp4', upsert: true });
    if (upErr) {
      console.error('[card-render-status] renders upload failed', upErr);
      return await respond(sb, render); // retry next poll
    }

    // Guarded transition to 'done'; only the winning poll flips the card.
    const { data: done } = await sb
      .from('card_renders')
      .update({ status: 'done', output_path: outputPath, error: null, updated_at: new Date().toISOString() })
      .eq('id', renderId)
      .eq('status', 'rendering')
      .select()
      .maybeSingle();
    if (done) {
      await sb.from('cards').update({ status: 'rendered' }).eq('id', card.id as string);
    }
    return await respond(sb, done ?? { ...render, status: 'done', output_path: outputPath });
  } catch (err) {
    console.error('[card-render-status] internal error', err);
    return json(500, { error: 'internal' });
  }
});
