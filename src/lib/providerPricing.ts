/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Which model paints an AI frame/sticker, what that costs the host, and the
 * copy that says so. Pure — no React, no supabase — so the rules the studio
 * panels, the copilot cards and the tests all read are ONE set of rules under
 * the vitest node env, instead of a block of pricing logic buried in a
 * component (audit F10).
 *
 * THE SERVER IS THE AUTHORITY ON PRICE. Everything here mirrors exactly one
 * line of supabase/functions/ai-generate-image/index.ts:
 *
 *     cost = isFreeTrial || byoKey ? 0 : { gemini: 1, higgsfield: 2 }[provider]
 *
 * — so a change there is a change here, and nowhere else. The one thing this
 * module deliberately does NOT model is the free-trial allowance in
 * {@link providerCostLabel}: the button says what a paid generation costs, and
 * the free-trial sentence lives in {@link providerHint}, which is where a host
 * reads about their allowance.
 */
import type { ProviderKeyStatus } from './providerKeysModel';

/** The image models a host can pick between. */
export type ImageProvider = 'gemini' | 'higgsfield';

/** Pill labels, in picker order. Beamwall AI first — it is the default and the
 *  one that always works. */
export const PROVIDER_LABELS: readonly { id: ImageProvider; label: string }[] = [
  { id: 'gemini', label: 'Beamwall AI' },
  { id: 'higgsfield', label: 'Higgsfield' },
];

/**
 * Can this org generate with Higgsfield right now — through its own key, or
 * through the platform's?
 *
 * `status === null` means NOT KNOWN YET (still loading) or the read FAILED.
 * Both answer false: promising a connection we have not confirmed would show a
 * price we cannot stand behind, and would leave the pill live while
 * {@link effectiveProvider} silently sends gemini instead (audit F9).
 */
export function higgsfieldReady(status: ProviderKeyStatus | null): boolean {
  return status !== null && (status.configured || status.platformAvailable);
}

/**
 * What we will actually SEND. A stored pick of 'higgsfield' from a previous
 * session falls back to gemini whenever Higgsfield is unusable for this org, so
 * a stale preference can never fail a generation.
 */
export function effectiveProvider(
  provider: ImageProvider,
  status: ProviderKeyStatus | null,
): ImageProvider {
  return provider === 'higgsfield' && !higgsfieldReady(status) ? 'gemini' : provider;
}

/**
 * The cost fragment for a Generate button, per the server's own rule. An org
 * with its own Higgsfield key pays Higgsfield directly and spends ZERO platform
 * credits; without one, the platform key costs 2.
 */
export function providerCostLabel(
  provider: ImageProvider,
  status: ProviderKeyStatus | null,
): string {
  if (provider === 'higgsfield') return status?.configured === true ? '0 credits' : '2 credits';
  return '1 credit';
}

/** Only ever sent when it is NOT the default — the request body stays
 *  byte-identical to before this control existed for every gemini generation. */
export function providerBody(provider: ImageProvider): { provider?: 'higgsfield' } {
  return provider === 'higgsfield' ? { provider: 'higgsfield' } : {};
}

/**
 * One honest line about what HIGGSFIELD costs this org. It is about Higgsfield
 * in every state because that is the side of the choice a host cannot already
 * guess; Beamwall AI's price is on the button.
 *
 * `statusFailed` separates the two shapes of `status === null`: still checking,
 * versus the check itself failed. Neither is "no key" — painting a connection
 * the org may well have would be a lie in the other direction.
 */
export function providerHint(
  status: ProviderKeyStatus | null,
  statusFailed: boolean,
  freeTrial: boolean,
): string {
  if (status === null) {
    return statusFailed
      ? 'Couldn’t check your Higgsfield connection — Beamwall AI still works.'
      : 'Checking your Higgsfield connection…';
  }
  if (status.configured) return 'Uses your connected Higgsfield account — 0 credits.';
  if (status.platformAvailable) {
    // The free allowance is spent BEFORE the provider price (server: isFreeTrial
    // wins over COSTS), so it overrides the number here too.
    return freeTrial
      ? 'Free while this event has free generations left, then 2 credits.'
      : '2 credits.';
  }
  return 'Not connected —';
}
