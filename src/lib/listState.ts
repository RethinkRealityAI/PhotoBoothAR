/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One decision, made in one place: what a list-backed screen should render.
 *
 * Screens across the app used to branch on `rows.length === 0` alone, which
 * silently merges three different situations into one message — the first
 * fetch still in flight, a fetch that failed, and a genuinely empty list. That
 * is how the wall came to tell guests "be the first to capture a moment" when
 * the network was down, and how the host dashboard came to say "no cards yet"
 * to a host who had cards.
 */

export type ListState = 'loading' | 'failed' | 'empty' | 'ready';

export interface ListStateInput {
  /** How many rows are currently held. */
  count: number;
  /** A fetch has completed at least once (successfully or not). */
  loaded: boolean;
  /** The most recent fetch failed. */
  failed: boolean;
}

/**
 * Rows win over everything: if we are holding data, show it, even if the most
 * recent refresh failed — dropping a populated list to an error screen because
 * one poll timed out is its own kind of dishonesty. Otherwise a failure is
 * reported as a failure, an in-flight first load as loading, and only a
 * completed, successful, zero-row read is reported as empty.
 */
export function listState({ count, loaded, failed }: ListStateInput): ListState {
  if (count > 0) return 'ready';
  if (failed) return 'failed';
  if (!loaded) return 'loading';
  return 'empty';
}
