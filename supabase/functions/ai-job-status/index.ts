/**
 * ai-job-status — poll an ai_jobs row; resolves async Meshy jobs on the fly.
 *
 * POST (deployed with verify_jwt ON — requires a real user JWT in Authorization)
 *   { jobId }                 poll ONE job; caller must be a member of its org
 *   { sweep: true }           scheduled reconciliation across every org — see
 *                             "Sweep mode" below and migration 019
 *
 * verify_jwt stays ON for both: the service-role key the scheduler presents is
 * itself a project-signed JWT, so it clears the gateway and is then checked
 * again in-function (isSweepCaller) before any sweep work happens.
 *
 * 200 → { job, experience?, progress? }
 *         job        = current ai_jobs row (possibly just transitioned)
 *         experience = created experiences row when THIS call completed a
 *                      Meshy job (kind '3d_attachment', unpublished)
 *         progress   = provider progress 0-100 while still running
 * 400 → { error: 'invalid_json' | 'invalid_body' }
 * 401 → { error: 'unauthorized' }
 * 403 → { error: 'forbidden' }         caller is not a member of the job's org
 * 404 → { error: 'job_not_found' }
 * 500 → { error: 'internal' }
 *
 * Meshy polling (env MESHY_API_KEY):
 *   text jobs  → GET https://api.meshy.ai/openapi/v2/text-to-3d/{taskId}
 *   image jobs → GET https://api.meshy.ai/openapi/v1/image-to-3d/{taskId}
 * On SUCCEEDED: download model_urls.glb, re-upload to the public assets bucket
 * at `${eventSlug}/ai/${jobId}.glb`, create the experiences row (config shape
 * matches Creator3D / the booth: config.anchor = { anchor, offset, rotation,
 * scale }), mark the job succeeded. On FAILED/CANCELED: refund the 10 credits
 * (grant_credits, reason 'ai_refund') and mark the job failed. The final
 * transition claims the row with `.eq('status','running')` so concurrent polls
 * can't double-create the experience or double-refund.
 *
 * Image (gemini/higgsfield) jobs are synchronous — polling them just returns
 * the stored row.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ASSETS_BUCKET = 'assets';
const MESHY_TEXT_URL = 'https://api.meshy.ai/openapi/v2/text-to-3d';
const MESHY_IMAGE_URL = 'https://api.meshy.ai/openapi/v1/image-to-3d';

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

interface MeshyTask {
  id?: string;
  status?: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | string;
  progress?: number;
  model_urls?: { glb?: string };
  task_error?: { message?: string } | null;
}

/**
 * Start the REFINE half of Meshy's two-stage text→3D.
 *
 * `mode: 'preview'` (what ai-generate-3d creates) returns GEOMETRY ONLY — a
 * bare grey mesh with no texture at all. Refine takes that task id and paints
 * it. We were shipping previews, which is why text-generated props looked
 * unfinished next to the image→3D ones (image→3D is single-stage and already
 * carries `should_texture: true`).
 *
 * Returns the refine task id, or null if refine could not be started for ANY
 * reason — the caller then ships the preview mesh. A missing texture is a much
 * smaller failure than losing a paid job, so this never throws.
 */
async function startRefine(previewTaskId: string, key: string): Promise<string | null> {
  // enable_pbr asks for the PBR map set; it is the newer of the two fields, so
  // a rejected body is retried WITHOUT it before giving up.
  const bodies: Record<string, unknown>[] = [
    { mode: 'refine', preview_task_id: previewTaskId, enable_pbr: true },
    { mode: 'refine', preview_task_id: previewTaskId },
  ];
  for (const body of bodies) {
    try {
      const res = await fetch(MESHY_TEXT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const parsed = (await res.json()) as { result?: string };
        if (typeof parsed.result === 'string' && parsed.result) return parsed.result;
        console.warn('[ai-job-status] refine returned no task id');
        return null;
      }
      const detail = await res.text().catch(() => '');
      console.warn('[ai-job-status] refine rejected', res.status, detail.slice(0, 300));
      // Only a 4xx is worth re-trying with a smaller body (an unknown field);
      // a 5xx or an auth failure will reject the minimal body just the same.
      if (res.status < 400 || res.status >= 500) return null;
    } catch (e) {
      console.warn('[ai-job-status] refine request failed', e);
      return null;
    }
  }
  return null;
}

/**
 * Preview owns the first half of the progress bar, refine the second — so the
 * bar never jumps back to 0 when a text job hands over between stages.
 *
 * `twoStage` is essential: image→3D is a SINGLE task, and scaling its progress
 * would leave its bar stuck at 50% for a job that had actually finished.
 */
function stagedProgress(twoStage: boolean, stage: string, raw: number): number {
  const p = Math.max(0, Math.min(100, raw));
  if (!twoStage) return Math.round(p);
  return stage === 'refine' ? 50 + Math.round(p / 2) : Math.round(p / 2);
}

/** Experience name derived from the job's prompt (≤40 chars). */
function nameFromPrompt(prompt: unknown): string {
  if (typeof prompt !== 'string' || !prompt.trim()) return 'AI 3D Model';
  const clean = prompt.trim().replace(/\s+/g, ' ');
  return clean.length <= 40 ? clean : `${clean.slice(0, 39)}…`;
}

/**
 * Claim the job, re-host the GLB and create the experiences row.
 *
 * Extracted because THREE paths now reach it: a finished single-stage image
 * job, a finished refine, and a refine that failed after a good preview (we
 * ship the untextured preview rather than refunding a mesh we actually have).
 * The claim is conditional on `status = 'running'` so concurrent polls can
 * never double-create the experience or double-refund.
 */
async function materializeModel(
  sb: Client,
  job: Record<string, unknown>,
  jobId: string,
  glbUrl: string | null,
  input: Record<string, unknown>,
  ref: unknown,
): Promise<Response> {
  const { data: claimed } = await sb
    .from('ai_jobs')
    .update({ updated_at: new Date().toISOString(), status: 'succeeded' })
    .eq('id', jobId)
    .eq('status', 'running')
    .select()
    .maybeSingle();
  if (!claimed) {
    // Another poll won the race — return whatever state it left behind.
    const { data: fresh } = await sb.from('ai_jobs').select('*').eq('id', jobId).maybeSingle();
    return json(200, { job: fresh ?? job });
  }

  try {
    if (!glbUrl) throw new Error('meshy_no_model_url');

    // Event slug for the storage path + experiences.event_id (text = slug).
    const { data: event, error: evErr } = await sb
      .from('events')
      .select('slug')
      .eq('id', job.event_id as string)
      .maybeSingle();
    if (evErr) throw evErr;
    if (!event) throw new Error('event_missing');
    const eventSlug = event.slug as string;

    // Re-host the GLB (Meshy asset URLs expire — assets are kept 3 days) in the
    // public assets bucket.
    const dl = await fetch(glbUrl);
    if (!dl.ok) throw new Error(`glb_download_${dl.status}`);
    const bytes = new Uint8Array(await dl.arrayBuffer());
    const path = `${eventSlug}/ai/${jobId}.glb`;
    const { error: upErr } = await sb.storage
      .from(ASSETS_BUCKET)
      .upload(path, bytes, { contentType: 'model/gltf-binary', upsert: true });
    if (upErr) throw upErr;
    const { data: pub } = sb.storage.from(ASSETS_BUCKET).getPublicUrl(path);
    const assetUrl = pub.publicUrl;

    // Experience config MUST match what Creator3D saves / the booth reads:
    // config.anchor = AnchorConfig { anchor, offset, rotation, scale }.
    // The anchor comes from the brief's piece kind (ai-generate-3d writes
    // `input.anchorHint` — an earring belongs on an ear, a nose ring on the
    // nose tip), falling back to 'crown', the top-of-head anchor every job used
    // before and the right default for a hat or a crown (src/lib/faceRig.ts).
    // The host fine-tunes placement in the 3D anchor editor afterwards.
    const prompt = input.prompt ?? null;
    const anchorHint = typeof input.anchorHint === 'string' && input.anchorHint
      ? input.anchorHint
      : 'crown';
    const { data: experience, error: expErr } = await sb
      .from('experiences')
      .insert({
        event_id: eventSlug,
        org_id: job.org_id as string,
        name: nameFromPrompt(prompt),
        kind: '3d_attachment',
        asset_url: assetUrl,
        thumbnail_url: null,
        config: {
          anchor: {
            anchor: anchorHint,
            offset: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: 1,
          },
          generated: true,
          prompt,
          // Honest provenance: `false` means the texture pass did not run or did
          // not finish, so the host is looking at bare geometry.
          textured: input.mode === 'image' || input.stage === 'refine',
        },
        is_published: false,
        featured: false,
        sort_order: 0,
        source: 'ai_meshy',
      })
      .select()
      .single();
    if (expErr || !experience) throw expErr ?? new Error('experience_insert_failed');

    const { data: doneJob, error: updErr } = await sb
      .from('ai_jobs')
      .update({ result_url: assetUrl, updated_at: new Date().toISOString() })
      .eq('id', jobId)
      .select()
      .single();
    if (updErr) throw updErr;

    return json(200, { job: doneJob ?? claimed, experience });
  } catch (err) {
    // Materialization failed AFTER the claim — refund + flip to failed so
    // credits are never left spent on a job with no asset.
    console.error('[ai-job-status] materialize error', jobId, err);
    const detail = err instanceof Error ? err.message : String(err);
    const { data: failedJob } = await sb
      .from('ai_jobs')
      .update({ status: 'failed', error: detail, updated_at: new Date().toISOString() })
      .eq('id', jobId)
      .select()
      .single();
    await refund(sb, job.org_id as string, job.credits_charged as number, ref);
    return json(200, { job: failedJob ?? claimed });
  }
}

async function refund(sb: Client, orgId: string, amount: number, ref: unknown): Promise<void> {
  const { error } = await sb.rpc('grant_credits', {
    p_org: orgId,
    p_amount: amount,
    p_reason: 'ai_refund',
    p_ref: (ref ?? null) as Record<string, unknown> | null,
  });
  if (error) console.error('[ai-job-status] REFUND FAILED', orgId, error);
}

/**
 * Poll ONE running Meshy job and perform whatever single transition is due:
 * report progress, hand a finished preview over to the refine pass, materialize
 * the finished model, or refund a failure.
 *
 * Extracted so the user-facing poll and the scheduled sweep share it. The
 * caller is responsible for authorising access to this job — the user path
 * checks org membership first; the sweep runs as the scheduler over every org.
 */
async function processMeshyJob(
  sb: Client,
  job: Record<string, unknown>,
  jobId: string,
): Promise<Response> {
  // 3. Only running Meshy jobs need provider polling; everything else is final
  //    (image jobs are synchronous) — return the stored row.
  if (job.status !== 'running' || job.provider !== 'meshy' || !job.provider_job_id) {
    return json(200, { job });
  }

  const input = (job.input ?? {}) as Record<string, unknown>;
  const ref = input.ref ?? { job_id: jobId };
  const meshyKey = Deno.env.get('MESHY_API_KEY');
  if (!meshyKey) {
    // Key was removed mid-flight — the task can never resolve. Refund + fail
    // (claimed conditionally so a concurrent poll can't double-refund).
    const { data: claimed } = await sb
      .from('ai_jobs')
      .update({ status: 'failed', error: 'ai_not_configured', updated_at: new Date().toISOString() })
      .eq('id', jobId)
      .eq('status', 'running')
      .select()
      .maybeSingle();
    if (claimed) await refund(sb, job.org_id as string, job.credits_charged as number, ref);
    return json(200, { job: claimed ?? job });
  }

  // 4. Poll Meshy (endpoint depends on the original mode).
  const baseUrl = input.mode === 'image' ? MESHY_IMAGE_URL : MESHY_TEXT_URL;
  const res = await fetch(`${baseUrl}/${job.provider_job_id}`, {
    headers: { Authorization: `Bearer ${meshyKey}` },
  });
  if (res.status === 404) {
    // Task unknown to Meshy — permanent; refund + fail.
    const { data: claimed } = await sb
      .from('ai_jobs')
      .update({ status: 'failed', error: 'meshy_task_not_found', updated_at: new Date().toISOString() })
      .eq('id', jobId)
      .eq('status', 'running')
      .select()
      .maybeSingle();
    if (claimed) await refund(sb, job.org_id as string, job.credits_charged as number, ref);
    return json(200, { job: claimed ?? job });
  }
  if (!res.ok) {
    // Transient provider error (rate limit, 5xx) — stay running; poll again.
    console.warn('[ai-job-status] meshy poll error', res.status);
    return json(200, { job });
  }
  const task = (await res.json()) as MeshyTask;

  // Which half of the text→3D pipeline this task belongs to. Image→3D is
  // single-stage, so it stays on 'preview' and never hands over.
  const twoStage = input.mode !== 'image';
  const stage = typeof input.stage === 'string' ? input.stage : 'preview';
  const previewGlbUrl = typeof input.previewGlbUrl === 'string' ? input.previewGlbUrl : null;

  // 5a. Still working → report progress.
  if (task.status === 'PENDING' || task.status === 'IN_PROGRESS') {
    return json(200, { job, progress: stagedProgress(twoStage, stage, task.progress ?? 0) });
  }

  // 5b. Failed / canceled → refund + mark failed (single claimant).
  if (task.status === 'FAILED' || task.status === 'CANCELED') {
    // A refine that failed after a good preview is NOT a lost job — we have a
    // real (untextured) mesh. Ship it rather than refunding something usable.
    if (stage === 'refine' && previewGlbUrl) {
      console.warn('[ai-job-status] refine failed — shipping the untextured preview', jobId);
      return await materializeModel(sb, job, jobId, previewGlbUrl, { ...input, stage: 'preview' }, ref);
    }
    const msg = task.task_error?.message || `meshy_${(task.status ?? 'failed').toLowerCase()}`;
    const { data: claimed } = await sb
      .from('ai_jobs')
      .update({ status: 'failed', error: msg, updated_at: new Date().toISOString() })
      .eq('id', jobId)
      .eq('status', 'running')
      .select()
      .maybeSingle();
    if (claimed) await refund(sb, job.org_id as string, job.credits_charged as number, ref);
    return json(200, { job: claimed ?? job });
  }

  // 5c. Succeeded.
  if (task.status === 'SUCCEEDED') {
    const glbUrl = task.model_urls?.glb ?? null;

    // Text→3D hands over here: the finished PREVIEW is untextured geometry,
    // so start the refine pass and stay 'running' rather than shipping a bare
    // grey mesh. Image→3D is single-stage (should_texture: true) and skips it.
    if (twoStage && stage === 'preview') {
      const refineId = await startRefine(job.provider_job_id as string, meshyKey);
      if (refineId) {
        // Single claimant: matching the CURRENT provider_job_id means only one
        // concurrent poll can move the job onto the refine task.
        //
        // KNOWN, BOUNDED RACE: two polls landing inside the same ~1s window
        // (two studio tabs open on the same job) both create a refine task at
        // Meshy, and only one is ever polled — so we pay Meshy for one wasted
        // refine. Claiming BEFORE the call would need a sentinel
        // provider_job_id, which a concurrent poll would then GET as a 404 and
        // refund a job that was fine. Correctness (no double-materialize, no
        // double-refund) is guarded here; the cost is ours, small, and rare.
        const { data: moved } = await sb
          .from('ai_jobs')
          .update({
            provider_job_id: refineId,
            input: { ...input, stage: 'refine', previewGlbUrl: glbUrl },
            updated_at: new Date().toISOString(),
          })
          .eq('id', jobId)
          .eq('status', 'running')
          .eq('provider_job_id', job.provider_job_id as string)
          .select()
          .maybeSingle();
        if (moved) return json(200, { job: moved, progress: 50 });
        const { data: fresh } = await sb.from('ai_jobs').select('*').eq('id', jobId).maybeSingle();
        return json(200, { job: fresh ?? job, progress: 50 });
      }
      // Refine could not be started (key rejected, unknown field, network).
      // Ship the untextured preview — a plain mesh beats a failed paid job.
      console.warn('[ai-job-status] refine unavailable — shipping the preview mesh', jobId);
    }

    return await materializeModel(sb, job, jobId, glbUrl ?? previewGlbUrl, input, ref);
  }

  // Unknown provider status — leave running; the client keeps polling.
  return json(200, { job, progress: task.progress ?? 0 });
}

/* ── Sweep mode (scheduled reconciliation) ───────────────────────────────
 * A Meshy job only advances when something polls it, and every poller in the
 * product is an in-flight UI loop. Close the tab and the job is finished at the
 * provider but frozen at `running` here forever: credits spent, no experience,
 * and Meshy deletes the asset after three days. The client-side sweep
 * (src/lib/useAiJobSweep.ts) fixes that for a host who comes BACK; this fixes it
 * for one who does not.
 *
 * It lives in this function rather than a new one so there is exactly ONE
 * implementation of the transition logic — the part that refunds credits and
 * creates experiences is not something to have two copies of.
 */

/** Don't touch a job younger than this — the longest UI poll budget is ~10
 *  minutes, and racing a live loop into the refine hand-off would pay Meshy for
 *  a duplicate task. Mirrors MIN_AGE_MS in src/lib/aiJobs.ts. */
const SWEEP_MIN_AGE_MS = 11 * 60 * 1000;
/** Past this, stop trying: Meshy keeps generated assets for three days, so a
 *  job still running after one day resolves into nothing useful. */
const SWEEP_ABANDON_MS = 24 * 60 * 60 * 1000;
/** Jobs per run. The scheduler comes back; a burst does not help. */
const SWEEP_BATCH = 10;

/**
 * Is this request the scheduler rather than a signed-in host?
 *
 * Authenticated with the service-role key, which this function already holds in
 * its own env — so scheduling needs no NEW secret, and a caller who can present
 * it could already do anything this function does. Compared with a constant
 * amount of work; an unset key can never match a presented one.
 */
function isSweepCaller(req: Request): boolean {
  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!expected) return false; // fail closed
  const got = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
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
    // 0. Scheduled sweep — reconcile abandoned jobs across every org. Checked
    //    BEFORE the user gate because there is no user; it is the scheduler.
    if (body.sweep === true) {
      if (!isSweepCaller(req)) return json(401, { error: 'unauthorized' });
      const sb = serviceClient();
      const now = Date.now();
      const { data: stale, error: staleErr } = await sb
        .from('ai_jobs')
        .select('id, created_at, updated_at')
        .eq('status', 'running')
        .eq('provider', 'meshy')
        .lte('created_at', new Date(now - SWEEP_MIN_AGE_MS).toISOString())
        .gte('created_at', new Date(now - SWEEP_ABANDON_MS).toISOString())
        .order('created_at', { ascending: true })
        .limit(SWEEP_BATCH);
      if (staleErr) throw staleErr;
      const ids = (stale ?? []).map((j) => j.id as string);
      // Each id re-enters this same function through the normal path, so the
      // transition logic (refine hand-off, materialize, refund) has one home.
      // Sequential on purpose: a burst of Meshy calls buys nothing here.
      let resolved = 0;
      for (const id of ids) {
        try {
          const { data: row } = await sb.from('ai_jobs').select('*').eq('id', id).maybeSingle();
          if (!row) continue;
          const res = await processMeshyJob(sb, row as Record<string, unknown>, id);
          // A 200 whose job is no longer `running` means this call finished it.
          const payload = (await res.clone().json()) as { job?: { status?: string } };
          if (payload.job && payload.job.status !== 'running') resolved++;
        } catch (e) {
          console.error('[ai-job-status] sweep item failed', id, e);
        }
      }
      console.log('[ai-job-status] sweep', { considered: ids.length, resolved });
      return json(200, { swept: ids.length, resolved });
    }

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

    const { jobId } = body;
    if (typeof jobId !== 'string' || !jobId) return json(400, { error: 'invalid_body' });

    const sb = serviceClient();

    // 2. Load the job + member check via its org.
    const { data: job, error: jobErr } = await sb
      .from('ai_jobs')
      .select('*')
      .eq('id', jobId)
      .maybeSingle();
    if (jobErr) throw jobErr;
    if (!job) return json(404, { error: 'job_not_found' });

    const { data: member, error: memErr } = await sb
      .from('org_members')
      .select('org_id')
      .eq('org_id', job.org_id as string)
      .eq('user_id', user.id)
      .maybeSingle();
    if (memErr) throw memErr;
    if (!member) return json(403, { error: 'forbidden' });

    // 3. Everything from here is the same work the scheduled sweep does.
    return await processMeshyJob(sb, job, jobId);
  } catch (err) {
    console.error('[ai-job-status] internal error', err);
    return json(500, { error: 'internal' });
  }
});
