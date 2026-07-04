/**
 * ai-job-status — poll an ai_jobs row; resolves async Meshy jobs on the fly.
 *
 * POST (deployed with verify_jwt ON — requires a real user JWT in Authorization)
 *   { jobId }
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

/** Experience name derived from the job's prompt (≤40 chars). */
function nameFromPrompt(prompt: unknown): string {
  if (typeof prompt !== 'string' || !prompt.trim()) return 'AI 3D Model';
  const clean = prompt.trim().replace(/\s+/g, ' ');
  return clean.length <= 40 ? clean : `${clean.slice(0, 39)}…`;
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

    // 5a. Still working → report progress.
    if (task.status === 'PENDING' || task.status === 'IN_PROGRESS') {
      return json(200, { job, progress: task.progress ?? 0 });
    }

    // 5b. Failed / canceled → refund + mark failed (single claimant).
    if (task.status === 'FAILED' || task.status === 'CANCELED') {
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

    // 5c. Succeeded → claim the job, then materialize the asset + experience.
    if (task.status === 'SUCCEEDED') {
      const glbUrl = task.model_urls?.glb;

      // Claim first so concurrent polls can't double-create the experience.
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

        // Re-host the GLB (Meshy asset URLs expire) in the public assets bucket.
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
        // 'crown' is the top-of-head anchor (see src/lib/faceRig.ts) — the
        // host fine-tunes placement in the 3D anchor editor afterwards.
        const prompt = input.prompt ?? null;
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
                anchor: 'crown',
                offset: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: 1,
              },
              generated: true,
              prompt,
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

    // Unknown provider status — leave running; the client keeps polling.
    return json(200, { job, progress: task.progress ?? 0 });
  } catch (err) {
    console.error('[ai-job-status] internal error', err);
    return json(500, { error: 'internal' });
  }
});
