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
  | 'ai_quota'
  | 'ai_not_configured'
  | 'ai_key_invalid'
  | 'rate_limited'
  | 'internal'
  | 'network';

/** Hard failures a retry cannot fix (bad/rejected provider key, missing config,
 *  no credits, tier gate, auth) — surfaces should NOT offer "try again". */
export function aiErrorRetryable(code: AiErrorCode): boolean {
  return (
    code !== 'ai_key_invalid' &&
    code !== 'ai_not_configured' &&
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
   * Optional public assets-bucket URL of a host-uploaded reference image. The
   * edge function fetches it server-side and passes it to Gemini as an inline
   * image part BEFORE the text prompt, so generation is guided by the reference
   * style/subject. Omitted → the request body is byte-identical to before.
   */
  referenceImageUrl?: string;
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
    case 'ai_quota':
      // Customer-safe (the provider-billing detail lives in the server logs).
      return 'The AI service is over capacity right now — any credits were refunded. Please try again in a little while.';
    case 'network':
      return 'Network error — check your connection and try again.';
    default:
      return 'Something went wrong — please try again.';
  }
}
