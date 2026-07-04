/**
 * ai-generate-3d — kick off an async Meshy text/image → 3D model job.
 *
 * POST (deployed with verify_jwt ON — requires a real user JWT in Authorization)
 *   { eventUuid, mode: 'text' | 'image', prompt?, imageUrl?, targetPolycount? }
 *     mode 'text'  → prompt required
 *     mode 'image' → imageUrl required (http/https)
 *
 * 200 → { job }                    ai_jobs row (status 'running',
 *                                  provider_job_id = Meshy task id) —
 *                                  poll ai-job-status until it resolves
 * 400 → { error: 'invalid_json' | 'invalid_body' }
 * 401 → { error: 'unauthorized' }
 * 402 → { error: 'insufficient_credits' }
 * 403 → { error: 'forbidden' | 'upgrade_required' }
 * 404 → { error: 'event_not_found' }
 * 500 → { error: 'internal' }
 * 502 → { error: 'generation_failed' }   Meshy rejected the task (refunded)
 * 503 → { error: 'ai_not_configured' }   MESHY_API_KEY missing (refunded)
 *
 * Meshy REST endpoints used:
 *   text  → POST https://api.meshy.ai/openapi/v2/text-to-3d
 *             { mode: 'preview', prompt, art_style: 'realistic',
 *               topology: 'triangle', target_polycount }
 *   image → POST https://api.meshy.ai/openapi/v1/image-to-3d
 *             { image_url, should_texture: true,
 *               target_polycount: min(input ?? 30000, 50000), topology: 'triangle' }
 * Both return { result: '<task-id>' }; completion is handled by ai-job-status.
 *
 * Credits: 10 per job (strategy doc), spent FIRST via spend_credits
 * (reason 'ai_3d'); any failure before the task is accepted refunds via
 * grant_credits (reason 'ai_refund') and marks the job failed.
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (injected),
 *      MESHY_API_KEY (secret).
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const COST_3D = 10;
const DEFAULT_POLYCOUNT = 30000;
const MAX_POLYCOUNT = 50000;

const MESHY_TEXT_URL = 'https://api.meshy.ai/openapi/v2/text-to-3d';
const MESHY_IMAGE_URL = 'https://api.meshy.ai/openapi/v1/image-to-3d';

/** Grandfathered coded events (see src/lib/entitlements.ts LEGACY_ENTITLEMENTS). */
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

async function shortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

class AiError extends Error {
  constructor(public code: 'ai_not_configured' | 'generation_failed', detail?: string) {
    super(detail ?? code);
  }
}

/** Create the Meshy task; returns the provider task id. */
async function createMeshyTask(
  mode: 'text' | 'image',
  prompt: string | null,
  imageUrl: string | null,
  targetPolycount: number,
): Promise<string> {
  const key = Deno.env.get('MESHY_API_KEY');
  if (!key) throw new AiError('ai_not_configured');

  const url = mode === 'text' ? MESHY_TEXT_URL : MESHY_IMAGE_URL;
  const reqBody = mode === 'text'
    ? {
        mode: 'preview',
        prompt,
        art_style: 'realistic',
        topology: 'triangle',
        target_polycount: targetPolycount,
      }
    : {
        image_url: imageUrl,
        should_texture: true,
        target_polycount: targetPolycount,
        topology: 'triangle',
      };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(reqBody),
  });
  if (!res.ok) {
    console.error('[ai-generate-3d] meshy error', res.status, await res.text().catch(() => ''));
    throw new AiError('generation_failed', `meshy_http_${res.status}`);
  }
  const body = (await res.json()) as { result?: string };
  if (!body.result || typeof body.result !== 'string') {
    throw new AiError('generation_failed', 'meshy_no_task_id');
  }
  return body.result;
}

async function refundAndFail(
  sb: Client,
  jobId: string,
  orgId: string,
  ref: Record<string, unknown>,
  errMsg: string,
): Promise<void> {
  const { error: refundErr } = await sb.rpc('grant_credits', {
    p_org: orgId,
    p_amount: COST_3D,
    p_reason: 'ai_refund',
    p_ref: ref,
  });
  if (refundErr) console.error('[ai-generate-3d] REFUND FAILED', jobId, refundErr);
  const { error: jobErr } = await sb
    .from('ai_jobs')
    .update({ status: 'failed', error: errMsg, updated_at: new Date().toISOString() })
    .eq('id', jobId);
  if (jobErr) console.error('[ai-generate-3d] job fail-mark error', jobId, jobErr);
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

    // 2. Validate body.
    const { eventUuid, mode } = body;
    if (typeof eventUuid !== 'string' || !eventUuid) return json(400, { error: 'invalid_body' });
    if (mode !== 'text' && mode !== 'image') return json(400, { error: 'invalid_body' });

    let prompt: string | null = null;
    let imageUrl: string | null = null;
    if (mode === 'text') {
      if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 2000) {
        return json(400, { error: 'invalid_body' });
      }
      prompt = body.prompt.trim();
    } else {
      if (typeof body.imageUrl !== 'string' || !/^https?:\/\//i.test(body.imageUrl)) {
        return json(400, { error: 'invalid_body' });
      }
      imageUrl = body.imageUrl;
      // Optional prompt used only for the experience name later.
      if (typeof body.prompt === 'string' && body.prompt.trim()) prompt = body.prompt.trim().slice(0, 2000);
    }
    const rawPoly = typeof body.targetPolycount === 'number' && Number.isFinite(body.targetPolycount)
      ? Math.round(body.targetPolycount)
      : DEFAULT_POLYCOUNT;
    const targetPolycount = Math.max(100, Math.min(rawPoly, MAX_POLYCOUNT));

    const sb = serviceClient();

    // 3. Event + org membership.
    const { data: event, error: evErr } = await sb
      .from('events')
      .select('id, slug, org_id, plan_tier')
      .eq('id', eventUuid)
      .maybeSingle();
    if (evErr) throw evErr;
    if (!event) return json(404, { error: 'event_not_found' });
    const orgId = event.org_id as string;

    const { data: member, error: memErr } = await sb
      .from('org_members')
      .select('org_id')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (memErr) throw memErr;
    if (!member) return json(403, { error: 'forbidden' });

    // 4. aiStudio entitlement (paid tier / active Pro subscription / legacy).
    let allowed = PAID_TIERS.has(event.plan_tier as string) || LEGACY_SLUGS.has(event.slug as string);
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

    // 5. Spend credits FIRST.
    const ref = { event_uuid: eventUuid, prompt_hash: await shortHash(prompt ?? imageUrl ?? '') };
    const { error: spendErr } = await sb.rpc('spend_credits', {
      p_org: orgId,
      p_amount: COST_3D,
      p_reason: 'ai_3d',
      p_ref: ref,
    });
    if (spendErr) {
      if (String(spendErr.message ?? '').includes('insufficient_credits')) {
        return json(402, { error: 'insufficient_credits' });
      }
      throw spendErr;
    }

    // 6. Job row first so every later failure path has something to refund against.
    const { data: job, error: jobErr } = await sb
      .from('ai_jobs')
      .insert({
        org_id: orgId,
        event_id: eventUuid,
        kind: 'model3d',
        provider: 'meshy',
        status: 'running',
        input: { mode, prompt, imageUrl, targetPolycount, ref },
        credits_charged: COST_3D,
      })
      .select()
      .single();
    if (jobErr || !job) {
      const { error: refundErr } = await sb.rpc('grant_credits', {
        p_org: orgId, p_amount: COST_3D, p_reason: 'ai_refund', p_ref: ref,
      });
      if (refundErr) console.error('[ai-generate-3d] REFUND FAILED (job insert)', refundErr);
      throw jobErr ?? new Error('job_insert_failed');
    }
    const jobId = job.id as string;

    // 7. Create the Meshy task; store its id on the running job.
    try {
      const taskId = await createMeshyTask(mode, prompt, imageUrl, targetPolycount);
      const { data: updated, error: updErr } = await sb
        .from('ai_jobs')
        .update({ provider_job_id: taskId, updated_at: new Date().toISOString() })
        .eq('id', jobId)
        .select()
        .single();
      if (updErr) throw updErr;
      return json(200, { job: updated ?? job });
    } catch (err) {
      const code = err instanceof AiError ? err.code : 'internal';
      const detail = err instanceof Error ? err.message : String(err);
      await refundAndFail(sb, jobId, orgId, ref, detail);
      if (code === 'ai_not_configured') return json(503, { error: 'ai_not_configured' });
      if (code === 'generation_failed') return json(502, { error: 'generation_failed' });
      console.error('[ai-generate-3d] internal error after spend', err);
      return json(500, { error: 'internal' });
    }
  } catch (err) {
    console.error('[ai-generate-3d] internal error', err);
    return json(500, { error: 'internal' });
  }
});
