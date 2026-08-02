/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Thin client for the AI edge functions (ai-generate-image, ai-generate-3d,
 * ai-job-status). Generation runs entirely server-side — credits, entitlement
 * checks, and the provider keys (GEMINI_API_KEY etc.) live on the functions;
 * no AI key ever ships to the browser. Error bodies are decoded from
 * FunctionsHttpError the same way managerApi.ts does.
 */
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { FrameLayout, LetteringSpec } from './assetPrompt';
import type { Experience } from '../types';

export type AiErrorCode =
  | 'invalid_json'
  | 'invalid_body'
  | 'unauthorized'
  | 'insufficient_credits'
  | 'forbidden'
  | 'upgrade_required'
  | 'event_not_found'
  | 'job_not_found'
  | 'generation_failed'
  /** The provider refused the prompt (safety / recitation / prohibited
   *  content). Distinct from generation_failed because the fix is different:
   *  rewording works, retrying the same words never will. */
  | 'content_blocked'
  | 'ai_quota'
  | 'ai_not_configured'
  | 'ai_key_invalid'
  | 'rate_limited'
  | 'internal'
  | 'network';

/** Hard failures a retry cannot fix (bad/rejected provider key, missing config,
 *  no credits, tier gate, auth) — surfaces should NOT offer "try again".
 *  `content_blocked` is in the list because every retry path re-runs the SAME
 *  stored prompt, and a prompt the provider refused will be refused again — the
 *  host has to reword it, which the error copy asks for. */
export function aiErrorRetryable(code: AiErrorCode): boolean {
  return (
    code !== 'ai_key_invalid' &&
    code !== 'ai_not_configured' &&
    code !== 'content_blocked' &&
    code !== 'insufficient_credits' &&
    code !== 'upgrade_required' &&
    code !== 'unauthorized' &&
    code !== 'forbidden'
  );
}

export interface AiJob {
  id: string;
  org_id: string;
  event_id: string | null;
  kind: 'image' | 'model3d';
  provider: string;
  provider_job_id: string | null;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'refunded';
  input: Record<string, unknown> | null;
  result_url: string | null;
  error: string | null;
  credits_charged: number;
  created_at: string;
  updated_at: string;
}

export interface AiResult<T> {
  data: T | null;
  error: AiErrorCode | null;
}

async function invokeAi<T>(name: string, body: Record<string, unknown>): Promise<AiResult<T>> {
  try {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) {
      if (error instanceof FunctionsHttpError) {
        try {
          const res = (await error.context.json()) as { error?: string };
          return { data: null, error: (res.error as AiErrorCode) ?? 'internal' };
        } catch {
          return { data: null, error: 'internal' };
        }
      }
      return { data: null, error: 'network' };
    }
    return { data: (data ?? null) as T, error: null };
  } catch (e) {
    console.error(`[ai] ${name}`, e);
    return { data: null, error: 'network' };
  }
}

/**
 * events.id uuid for the edge-function body. Legacy coded events resolve
 * through their (publicly readable) events row — the three grandfathered slugs
 * were seeded into the events table, so AI works from the legacy /admin too
 * (the caller still needs to be signed in as a member of the event's org).
 */
export async function resolveEventUuid(
  eventId: string,
  eventUuid: string | null,
): Promise<string | null> {
  if (eventUuid) return eventUuid;
  const { data, error } = await supabase
    .from('events')
    .select('id')
    .eq('slug', eventId)
    .maybeSingle();
  if (error) {
    console.error('[ai] resolveEventUuid', error);
    return null;
  }
  return (data?.id as string) ?? null;
}

/* ── Image generation (synchronous — resolves with the experience) ──── */

export interface GenerateImageOpts {
  prompt: string;
  /** 'higgsfield' costs 2 platform credits — or ZERO when the org brought its own
   *  Higgsfield key (server-resolved from org_provider_keys; see providerKeys.ts). */
  provider?: 'gemini' | 'higgsfield';
  kind?: '2d_filter' | 'border';
  transparentBackground?: boolean;
  /**
   * Ask the provider to paint the frame's centre + background a solid pure
   * green (#00FF00) chroma-key backdrop instead of a real transparent PNG
   * (which the image models don't produce cleanly). The browser keys the green
   * out to transparency after download — see studio/chromaKey.ts. When omitted
   * the edge function's prompt is byte-identical to before.
   */
  greenScreen?: boolean;
  /**
   * Which FRAME ARCHETYPE to generate — a classic edge border, a full
   * illustrated scene with a head cutout, a two-head version of it, corner
   * clusters, or a lower-third band. Border kind only. Omitted →
   * 'classic-border', which is the prompt (and the model) every frame used
   * before archetypes existed. See FRAME_LAYOUT_SPEC in ./assetPrompt.
   */
  layout?: FrameLayout;
  /**
   * Put real lettering ON the artwork — a couple's names, initials, a monogram.
   * The edge function re-validates it and swaps its standing "no text" ban for
   * an exact-text instruction. Omitted → the prompt is byte-identical to
   * before lettering existed. A MALFORMED object is rejected with
   * `invalid_body` rather than silently dropped, so a host never pays a credit
   * for a frame that quietly lost their name. placement 'standalone' means "no
   * frame, just the name art" — send it with kind '2d_filter'.
   */
  lettering?: LetteringSpec;
  /**
   * Let the edge function add its art-direction layer (composition, palette,
   * craft, quality bar). Default true. Pass false when the prompt is already
   * complete and purpose-built — the 3D concept image does, because
   * buildConceptPrompt carries wearable-geometry rules that generic sticker
   * art direction would fight.
   */
  artDirection?: boolean;
  /**
   * Optional public assets-bucket URL of a host-uploaded reference image. The
   * edge function fetches it server-side and passes it to Gemini as an inline
   * image part BEFORE the text prompt, so generation is guided by the reference
   * style/subject. Omitted → the request body is byte-identical to before.
   */
  referenceImageUrl?: string;
  /**
   * What to name the resulting experiences row when the prompt is a poor name
   * for it. The 3D concept image passes the host's raw brief here, because its
   * `prompt` is a full geometry specification and naming a Library row after
   * that reads as "Product concept art of ONE object f…". Omitted → the prompt
   * names it, as before.
   */
  nameHint?: string;
}

export function generateImage(
  eventUuid: string,
  opts: GenerateImageOpts,
): Promise<AiResult<{ job: AiJob; experience: Experience }>> {
  return invokeAi('ai-generate-image', { eventUuid, ...opts });
}

/* ── 3D generation (async — poll the returned job) ──────────────────── */

export interface Generate3dOpts {
  mode: 'text' | 'image';
  prompt?: string;
  imageUrl?: string;
  targetPolycount?: number;
}

export function generate3d(
  eventUuid: string,
  opts: Generate3dOpts,
): Promise<AiResult<{ job: AiJob }>> {
  return invokeAi('ai-generate-3d', { eventUuid, ...opts });
}

export function pollJob(
  jobId: string,
): Promise<AiResult<{ job: AiJob; experience?: Experience; progress?: number }>> {
  return invokeAi('ai-job-status', { jobId });
}

/* ── Credits (balance of the org that generation actually charges) ───── */

/**
 * The credit balance of the EVENT's org — the org ai-generate-image /
 * ai-generate-3d actually charge (event.org_id), which for multi-org members
 * can differ from `fetchMyOrg()`'s first membership. Null when unknown
 * (query failure or no balance row) — a real balance of 0 returns 0.
 */
export async function fetchEventCreditBalance(eventUuid: string): Promise<number | null> {
  try {
    const { data: ev, error: evErr } = await supabase
      .from('events')
      .select('org_id')
      .eq('id', eventUuid)
      .maybeSingle();
    if (evErr || ev?.org_id === null || ev?.org_id === undefined) {
      if (evErr) console.error('[ai] fetchEventCreditBalance event', evErr);
      return null;
    }
    const { data, error } = await supabase
      .from('credit_balances')
      .select('balance')
      .eq('org_id', ev.org_id as string)
      .maybeSingle();
    if (error || data === null || data === undefined) {
      if (error) console.error('[ai] fetchEventCreditBalance balance', error);
      return null;
    }
    return typeof data.balance === 'number' ? data.balance : null;
  } catch (e) {
    console.error('[ai] fetchEventCreditBalance', e);
    return null;
  }
}

/* ── Shared UI copy for the studio panels ────────────────────────────── */

export function aiErrorMessage(code: AiErrorCode): string {
  switch (code) {
    case 'insufficient_credits':
      return 'Not enough credits — top up in Billing.';
    case 'upgrade_required':
      return 'AI Studio is a paid feature — upgrade this event to unlock it.';
    case 'ai_not_configured':
    case 'ai_key_invalid':
      // Customer-safe: the real cause (missing/rejected GEMINI_API_KEY) is a
      // platform config problem — surfaces log the code; retrying can't fix it.
      return 'Our AI service is temporarily unavailable — all the manual tools still work. Retrying won’t help until it’s restored.';
    case 'rate_limited':
      return 'You’ve hit the hourly AI limit — give it a few minutes and try again.';
    case 'unauthorized':
      return 'Sign in to your host account to use AI generation.';
    case 'forbidden':
      return 'Your account does not have access to this event.';
    case 'event_not_found':
      return 'This event is not registered on the platform.';
    case 'generation_failed':
      return 'Generation failed — credits were refunded. Try a different prompt.';
    case 'content_blocked':
      // Retrying the same words is guaranteed to fail again, so say what to change.
      return 'The AI wouldn’t make that one — credits were refunded. Try describing it differently (real people, brands and logos are usually the blocker).';
    case 'ai_quota':
      // Customer-safe (the provider-billing detail lives in the server logs).
      return 'The AI service is over capacity right now — any credits were refunded. Please try again in a little while.';
    case 'network':
      return 'Network error — check your connection and try again.';
    default:
      return 'Something went wrong — please try again.';
  }
}
