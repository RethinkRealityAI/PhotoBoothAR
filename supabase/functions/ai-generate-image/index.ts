/**
 * ai-generate-image — server-side AI image generation for the AR studio.
 *
 * POST (deployed with verify_jwt ON — requires a real user JWT in Authorization)
 *   { eventUuid, prompt,
 *     provider?: 'gemini' | 'higgsfield'        (default 'gemini')
 *     kind?: '2d_filter' | 'border'             (default '2d_filter')
 *     transparentBackground?: boolean }
 *
 * 200 → { job, experience }        job = ai_jobs row (succeeded),
 *                                  experience = unpublished experiences row
 * 400 → { error: 'invalid_json' | 'invalid_body' }
 * 401 → { error: 'unauthorized' }
 * 402 → { error: 'insufficient_credits' }
 * 403 → { error: 'forbidden' | 'upgrade_required' }
 * 404 → { error: 'event_not_found' }
 * 500 → { error: 'internal' }
 * 502 → { error: 'generation_failed' }   provider errored (credits refunded)
 * 503 → { error: 'ai_not_configured' }   provider key missing (credits refunded)
 *
 * Flow: auth → event + org membership → server-side aiStudio entitlement →
 * spend credits FIRST (atomic rpc) → ai_jobs row (running) → provider call →
 * store PNG in the public assets bucket → unpublished experiences row →
 * ai_jobs succeeded. ANY failure after the spend refunds via grant_credits
 * (reason 'ai_refund', same ref) and marks the job failed — credits are never
 * left spent on a failed job.
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (injected),
 *      GEMINI_API_KEY (secret — moved server-side from the old client-only
 *      VITE_GEMINI_API_KEY), HIGGSFIELD_API_KEY + HIGGSFIELD_API_URL (secrets,
 *      not provisioned yet — until then higgsfield returns ai_not_configured).
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ASSETS_BUCKET = 'assets';
const GEMINI_MODEL = 'gemini-2.5-flash-image';

/** Credit cost per provider (strategy doc: gemini image 1cr, higgsfield 2cr). */
const COSTS = { gemini: 1, higgsfield: 2 } as const;
type Provider = keyof typeof COSTS;

/** Every event's first N image generations are FREE for every tier — no
 *  credits spent, no upgrade gate — so hosts taste the AI studio before
 *  paying. Counted per event over non-failed image jobs (failed jobs were
 *  refunded and don't consume the allowance). Server-authoritative. */
const FREE_IMAGES_PER_EVENT = 3;

const KINDS = new Set(['2d_filter', 'border']);

/** Grandfathered coded events: full-capability (mirrors LEGACY_ENTITLEMENTS
 *  in src/lib/entitlements.ts) even though their events rows say 'free'. */
const LEGACY_SLUGS = new Set(['hope-gala', 'jenna-jake', 'detola-wuyi']);

const PAID_TIERS = new Set(['essentials', 'premium', 'deluxe']);

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

/** Short stable hash of the prompt for the credit-ledger ref. */
async function promptHash(prompt: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(prompt));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Cheap alpha probe: PNG signature + IHDR color type only (no full decode).
 * Color type 4 (gray+alpha) or 6 (RGBA) carry an alpha channel. Anything that
 * isn't decodable as a PNG header is treated as opaque.
 */
function pngHasAlpha(bytes: Uint8Array): boolean {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 26) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIG[i]) return false;
  // First chunk must be IHDR ("IHDR" at offset 12); color type is IHDR byte 9
  // (offset 25 = 8 sig + 4 length + 4 type + 4 width + 4 height + 1 bit depth).
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return false;
  }
  const colorType = bytes[25];
  return colorType === 4 || colorType === 6;
}

/** Experience name derived from the prompt (≤40 chars). */
function nameFromPrompt(prompt: string): string {
  const clean = prompt.trim().replace(/\s+/g, ' ');
  return clean.length <= 40 ? clean : `${clean.slice(0, 39)}…`;
}

/** Kind-aware prompt wrapper (mirrors the old Creator2D client-side intent). */
function buildPrompt(prompt: string, kind: string, transparent: boolean): string {
  const base = kind === 'border'
    ? 'Create a decorative full-frame border/frame overlay for a 1080x1920 portrait ' +
      'photo-booth camera frame. The ornamentation hugs the edges; the CENTER of the ' +
      'frame must stay completely clear so the camera subject shows through.'
    : 'Create a single decorative sticker overlay for an elegant event photo booth. ' +
      'One clear centered subject, bold and readable at small sizes.';
  const alpha = transparent
    ? ' Render on a fully TRANSPARENT background (PNG with alpha channel) — no backdrop, no solid color fill.'
    : '';
  return `${base}${alpha} Design brief: ${prompt}`;
}

/* ── Providers ──────────────────────────────────────────────────────── */

class AiError extends Error {
  constructor(public code: 'ai_not_configured' | 'generation_failed', detail?: string) {
    super(detail ?? code);
  }
}

/** Gemini image generation — REST generateContent with IMAGE modality.
 *  (Server-side move of the old browser call to generativelanguage.googleapis.com
 *  in Creator2D; the image model returns inlineData base64 instead of SVG text.) */
async function generateGemini(prompt: string): Promise<Uint8Array> {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new AiError('ai_not_configured');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    },
  );
  if (!res.ok) {
    console.error('[ai-generate-image] gemini error', res.status, await res.text().catch(() => ''));
    throw new AiError('generation_failed', `gemini_http_${res.status}`);
  }
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
  };
  const part = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new AiError('generation_failed', 'gemini_no_image');
  return base64ToBytes(part.inlineData.data);
}

/** Typed Higgsfield request scaffold — keys are not provisioned yet, so this
 *  path returns ai_not_configured (with refund) until they exist. */
interface HiggsfieldImageRequest {
  prompt: string;
  width: number;
  height: number;
  output_format: 'png';
}
interface HiggsfieldImageResponse {
  images?: { url?: string; b64_json?: string }[];
}

async function generateHiggsfield(prompt: string): Promise<Uint8Array> {
  const key = Deno.env.get('HIGGSFIELD_API_KEY');
  const apiUrl = Deno.env.get('HIGGSFIELD_API_URL');
  // Intended endpoint once keys are provisioned:
  //   POST `${HIGGSFIELD_API_URL}/v1/images/generations`
  //   headers: { Authorization: `Bearer ${HIGGSFIELD_API_KEY}` }
  //   body:    HiggsfieldImageRequest (portrait 1080x1920 PNG)
  //   resp:    HiggsfieldImageResponse — b64_json inline or a downloadable url
  if (!key || !apiUrl) throw new AiError('ai_not_configured');

  const reqBody: HiggsfieldImageRequest = {
    prompt,
    width: 1080,
    height: 1920,
    output_format: 'png',
  };
  const res = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(reqBody),
  });
  if (!res.ok) {
    console.error('[ai-generate-image] higgsfield error', res.status, await res.text().catch(() => ''));
    throw new AiError('generation_failed', `higgsfield_http_${res.status}`);
  }
  const body = (await res.json()) as HiggsfieldImageResponse;
  const image = body.images?.[0];
  if (image?.b64_json) return base64ToBytes(image.b64_json);
  if (image?.url) {
    const dl = await fetch(image.url);
    if (!dl.ok) throw new AiError('generation_failed', 'higgsfield_download');
    return new Uint8Array(await dl.arrayBuffer());
  }
  throw new AiError('generation_failed', 'higgsfield_no_image');
}

/* ── Refund helper — never leave credits spent on a failed job ──────── */

async function refundAndFail(
  sb: Client,
  jobId: string,
  orgId: string,
  amount: number,
  ref: Record<string, unknown>,
  errMsg: string,
): Promise<void> {
  if (amount > 0) {
    const { error: refundErr } = await sb.rpc('grant_credits', {
      p_org: orgId,
      p_amount: amount,
      p_reason: 'ai_refund',
      p_ref: ref,
    });
    if (refundErr) console.error('[ai-generate-image] REFUND FAILED', jobId, refundErr);
  }
  const { error: jobErr } = await sb
    .from('ai_jobs')
    .update({ status: 'failed', error: errMsg, updated_at: new Date().toISOString() })
    .eq('id', jobId);
  if (jobErr) console.error('[ai-generate-image] job fail-mark error', jobId, jobErr);
}

/* ── Handler ────────────────────────────────────────────────────────── */

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
    const { eventUuid, prompt } = body;
    if (typeof eventUuid !== 'string' || !eventUuid) return json(400, { error: 'invalid_body' });
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000) {
      return json(400, { error: 'invalid_body' });
    }
    const provider = (body.provider ?? 'gemini') as Provider;
    if (provider !== 'gemini' && provider !== 'higgsfield') return json(400, { error: 'invalid_body' });
    const kind = (body.kind ?? '2d_filter') as string;
    if (!KINDS.has(kind)) return json(400, { error: 'invalid_body' });
    const transparentBackground = body.transparentBackground === true;

    const sb = serviceClient();

    // 3. Event + org membership (same pattern as stripe-checkout).
    const { data: event, error: evErr } = await sb
      .from('events')
      .select('id, slug, org_id, plan_tier')
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

    // 4a. Trial allowance: the event's first FREE_IMAGES_PER_EVENT image
    //     generations bypass both the entitlement gate and the credit spend.
    //     (Count is best-effort — two exactly-concurrent requests could both
    //     read the same count; the worst case is one extra free image.)
    const { count: usedImages, error: cntErr } = await sb
      .from('ai_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventUuid)
      .eq('kind', 'image')
      .neq('status', 'failed');
    if (cntErr) throw cntErr;
    const isFreeTrial = (usedImages ?? 0) < FREE_IMAGES_PER_EVENT;

    // 4b. Server-side aiStudio entitlement: paid event tier, active org Pro
    //     subscription, or grandfathered legacy slug. Free tier → upgrade
    //     (once the trial allowance is exhausted).
    if (!isFreeTrial) {
      let allowed = PAID_TIERS.has(event.plan_tier as string) || LEGACY_SLUGS.has(eventSlug);
      if (!allowed) {
        const { data: sub, error: subErr } = await sb
          .from('subscriptions')
          .select('org_id')
          .eq('org_id', orgId)
          .eq('status', 'active')
          .maybeSingle();
        if (subErr) throw subErr;
        allowed = Boolean(sub);
      }
      if (!allowed) return json(403, { error: 'upgrade_required' });
    }

    // 5. Spend credits FIRST (atomic; raises 'insufficient_credits').
    //    Trial generations cost 0 — nothing is spent and nothing refunds.
    const cost = isFreeTrial ? 0 : COSTS[provider];
    const ref = { event_uuid: eventUuid, prompt_hash: await promptHash(prompt) };
    if (cost > 0) {
      const { error: spendErr } = await sb.rpc('spend_credits', {
        p_org: orgId,
        p_amount: cost,
        p_reason: 'ai_image',
        p_ref: ref,
      });
      if (spendErr) {
        if (String(spendErr.message ?? '').includes('insufficient_credits')) {
          return json(402, { error: 'insufficient_credits' });
        }
        throw spendErr;
      }
    }

    // 6. Record the job (running). If even this insert fails, refund directly.
    const { data: job, error: jobErr } = await sb
      .from('ai_jobs')
      .insert({
        org_id: orgId,
        event_id: eventUuid,
        kind: 'image',
        provider,
        status: 'running',
        input: { prompt, kind, transparentBackground, provider },
        credits_charged: cost,
      })
      .select()
      .single();
    if (jobErr || !job) {
      if (cost > 0) {
        const { error: refundErr } = await sb.rpc('grant_credits', {
          p_org: orgId, p_amount: cost, p_reason: 'ai_refund', p_ref: ref,
        });
        if (refundErr) console.error('[ai-generate-image] REFUND FAILED (job insert)', refundErr);
      }
      throw jobErr ?? new Error('job_insert_failed');
    }
    const jobId = job.id as string;

    // 7. Everything after the spend refunds on failure.
    try {
      const fullPrompt = buildPrompt(prompt, kind, transparentBackground);
      const bytes = provider === 'gemini'
        ? await generateGemini(fullPrompt)
        : await generateHiggsfield(fullPrompt);

      // Transparency flag: requested AND the PNG actually carries alpha.
      // Opaque output is still accepted — just flagged config.transparent=false.
      const transparent = transparentBackground && pngHasAlpha(bytes);

      // 8. Store in the public assets bucket + build the public URL.
      const path = `${eventSlug}/ai/${jobId}.png`;
      const { error: upErr } = await sb.storage
        .from(ASSETS_BUCKET)
        .upload(path, bytes, { contentType: 'image/png', upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = sb.storage.from(ASSETS_BUCKET).getPublicUrl(path);
      const assetUrl = pub.publicUrl;

      // 9. Unpublished experiences row for the studio library.
      const { data: experience, error: expErr } = await sb
        .from('experiences')
        .insert({
          event_id: eventSlug,
          org_id: orgId,
          name: nameFromPrompt(prompt),
          kind,
          asset_url: assetUrl,
          thumbnail_url: assetUrl,
          config: {
            generated: true,
            prompt,
            provider,
            transparent,
            // Booth defaults so the asset renders immediately when published.
            transform: { scale: 1, x: 0, y: 0, rotation: 0 },
            opacity: 1,
          },
          is_published: false,
          featured: false,
          sort_order: 0,
          source: provider === 'gemini' ? 'ai_gemini' : 'ai_higgsfield',
        })
        .select()
        .single();
      if (expErr || !experience) throw expErr ?? new Error('experience_insert_failed');

      // 10. Close the job.
      const { data: doneJob, error: updErr } = await sb
        .from('ai_jobs')
        .update({ status: 'succeeded', result_url: assetUrl, updated_at: new Date().toISOString() })
        .eq('id', jobId)
        .select()
        .single();
      if (updErr) throw updErr;

      return json(200, { job: doneJob ?? job, experience });
    } catch (err) {
      const code = err instanceof AiError ? err.code : 'internal';
      const detail = err instanceof Error ? err.message : String(err);
      await refundAndFail(sb, jobId, orgId, cost, ref, detail);
      if (code === 'ai_not_configured') return json(503, { error: 'ai_not_configured' });
      if (code === 'generation_failed') return json(502, { error: 'generation_failed' });
      console.error('[ai-generate-image] internal error after spend', err);
      return json(500, { error: 'internal' });
    }
  } catch (err) {
    console.error('[ai-generate-image] internal error', err);
    return json(500, { error: 'internal' });
  }
});
