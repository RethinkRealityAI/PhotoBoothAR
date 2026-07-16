/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Challenge AI photo-check — client side. Pure config helpers (node-tested) plus
 * the guest-facing edge-fn call that judges a captured photo against a
 * challenge's visual requirement.
 *
 * Design: the check is a *gamification* gate, not a security boundary — so it
 * FAILS OPEN. Any AI/network error lets the guest post (a party booth must never
 * hard-block on an AI hiccup); only an explicit `pass:false` from the model
 * blocks the shot from counting for the challenge.
 */
import type { Challenge, ChallengeValidation } from '../types';

/**
 * Coerce raw form / AI input into a clean validation config, or null when there
 * is effectively no check (disabled, or enabled without a prompt — you can't
 * check nothing). Null is the stored shape for "no check", which the edge fn
 * and `challengeNeedsCheck` both read as pass-through.
 */
export function normalizeValidation(raw: unknown): ChallengeValidation | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const enabled = r.enabled === true;
  const prompt = typeof r.prompt === 'string' ? r.prompt.trim().slice(0, 500) : '';
  if (!enabled || !prompt) return null;
  const refRaw = typeof r.referenceImageUrl === 'string' ? r.referenceImageUrl.trim() : '';
  return { enabled: true, prompt, referenceImageUrl: refRaw ? refRaw.slice(0, 500) : null };
}

/** True when a captured photo for this challenge must pass an AI check first. */
export function challengeNeedsCheck(
  challenge: Pick<Challenge, 'validation'> | null | undefined,
): boolean {
  const v = challenge?.validation;
  return !!v && v.enabled === true && typeof v.prompt === 'string' && v.prompt.trim().length > 0;
}

export interface ChallengeCheckOutcome {
  pass: boolean;
  /** One friendly sentence for the guest (empty when there was nothing to say). */
  reason: string;
  /** true when we could not actually run the check (AI/network error) and let
   *  the photo through anyway. Callers may surface this differently if desired. */
  failedOpen?: boolean;
}

/** An inline image for the vision check (base64, no data: prefix). */
export interface CheckImage {
  data: string;
  mimeType: string;
}

/**
 * Ask the server to judge `image` against the challenge's requirement. Fails
 * open on any error (see file header). The prompt/reference live server-side on
 * the challenge row — only ids + the image travel here.
 */
export async function validateChallengePhoto(
  eventSlug: string,
  challengeId: string,
  image: CheckImage,
): Promise<ChallengeCheckOutcome> {
  try {
    // Lazy import keeps this module importable in the node test env (the
    // supabase client needs VITE_ env vars the tests don't provide).
    const { supabase } = await import('./supabase');
    const { data, error } = await supabase.functions.invoke('validate-challenge-photo', {
      body: { eventSlug, challengeId, image },
    });
    if (error) {
      console.warn('[challengeValidation] check errored, failing open', error);
      return { pass: true, reason: '', failedOpen: true };
    }
    const res = (data ?? {}) as { pass?: boolean; reason?: string };
    // Only an explicit false blocks; a missing/garbled verdict fails open.
    return { pass: res.pass !== false, reason: typeof res.reason === 'string' ? res.reason : '' };
  } catch (e) {
    console.warn('[challengeValidation] invoke failed, failing open', e);
    return { pass: true, reason: '', failedOpen: true };
  }
}
