/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The decisions behind the day-of manager console's moderation queue (/m/:slug).
 * Pure — unit tested — because every one of them used to be either missing or a
 * no-op inside the component.
 *
 * WHY POLLING AND NOT REALTIME. The obvious fix for "the console never learns
 * about a new post" is `subscribeToPosts`. It does not work here, and the way it
 * fails is the worst possible one: silently, on exactly the rows that matter.
 * The console authenticates with a manager access TOKEN in the request body
 * (see lib/managerApi.ts); the browser's Supabase client carries only the anon
 * key, and Realtime applies RLS for the subscribing role. The only SELECT policy
 * anon has on `posts` is `posts_public_read` (migration 003):
 *
 *     (approved and not hidden and event_is_public(event_id))
 *     or is_event_member(event_id)
 *
 * A pre-moderation arrival is `approved = false`, and anon is not a member — so
 * a realtime channel would stream every post EXCEPT the unapproved ones. The
 * approval queue would stay exactly as blind as it is today while looking live.
 * `manager-api` runs on the service role and already returns hidden and
 * unapproved rows, so the honest live feed is a poll through it.
 */
import type { Post } from '../types';

/* ── Buckets ───────────────────────────────────────────────────────── */

/**
 * The three buckets partition the list exactly once: `hidden` wins over
 * everything (a hidden post is off the wall whatever its approval says), then
 * approval splits the rest. Anything else double-counts, and a pending badge
 * that disagrees with the pending tab is a badge staff stop trusting.
 */
export type QueueFilter = 'pending' | 'live' | 'hidden' | 'all';

export const QUEUE_FILTERS: QueueFilter[] = ['pending', 'live', 'hidden', 'all'];

export interface QueueCounts {
  all: number;
  /** Awaiting a decision: not approved, not hidden. */
  pending: number;
  /** On the wall right now. */
  live: number;
  hidden: number;
}

export function bucketOf(post: Post): Exclude<QueueFilter, 'all'> {
  if (post.hidden) return 'hidden';
  return post.approved ? 'live' : 'pending';
}

export function queueCounts(posts: Post[]): QueueCounts {
  const counts: QueueCounts = { all: posts.length, pending: 0, live: 0, hidden: 0 };
  for (const p of posts) counts[bucketOf(p)] += 1;
  return counts;
}

export function filterPosts(posts: Post[], filter: QueueFilter): Post[] {
  if (filter === 'all') return posts;
  return posts.filter((p) => bucketOf(p) === filter);
}

/* ── Live arrivals ─────────────────────────────────────────────────── */

export interface MergeResult {
  posts: Post[];
  /** Ids present in the new server list that were not in the previous one. */
  arrivedIds: string[];
}

/**
 * The server list is authoritative — it is the service role's view, and a post
 * deleted or edited from the host studio must not be resurrected by a stale
 * local copy. All this adds is "which of these are new to me", so the console
 * can say `3 new` instead of silently swapping the grid under a thumb that is
 * already moving toward a button.
 */
export function mergeIncoming(prev: Post[], incoming: Post[]): MergeResult {
  const seen = new Set(prev.map((p) => p.id));
  const arrivedIds: string[] = [];
  for (const p of incoming) if (!seen.has(p.id)) arrivedIds.push(p.id);
  return { posts: incoming, arrivedIds };
}

/* ── Poll cadence ──────────────────────────────────────────────────── */

export const POLL_ACTIVE_MS = 5_000;
export const POLL_BACKGROUND_MS = 30_000;
export const POLL_MAX_MS = 60_000;

export interface PollInput {
  /** Consecutive failed polls; 0 after any success. */
  consecutiveErrors: number;
  /** document.hidden — the tab is not on screen. */
  documentHidden: boolean;
}

/**
 * Venue wifi is the design constraint. A fixed 5s poll that keeps firing into a
 * dead network burns the phone's battery in the middle of the one event it was
 * brought to, so failures back off exponentially; a backgrounded tab drops to a
 * slow keep-warm (the console forces an immediate poll on visibilitychange, so
 * the operator never reads a stale screen).
 */
export function nextPollDelayMs({ consecutiveErrors, documentHidden }: PollInput): number {
  const base = documentHidden ? POLL_BACKGROUND_MS : POLL_ACTIVE_MS;
  if (consecutiveErrors <= 0) return base;
  return Math.min(base * 2 ** consecutiveErrors, POLL_MAX_MS);
}

/* ── Keyboard traversal ────────────────────────────────────────────── */

/**
 * Clamped, never wrapping. Wrapping a moderation queue means the operator who
 * holds `j` at the bottom silently lands back at the top and re-decides posts
 * they already cleared.
 */
export function moveIndex(index: number, delta: number, length: number): number {
  if (length <= 0) return -1;
  if (index < 0) return delta > 0 ? 0 : length - 1;
  const next = index + delta;
  if (next < 0) return 0;
  if (next > length - 1) return length - 1;
  return next;
}

/* ── Undo ──────────────────────────────────────────────────────────── */

/**
 * Only hide and approve are undoable, and that is a statement about the data,
 * not a shortcut: `delete_post` removes the row (manager-api's delete_post is a
 * hard DELETE, matching db.deletePost), so there is nothing left to restore. The
 * console therefore keeps delete behind an explicit confirm and offers hide as
 * the reversible way to take something off the wall.
 */
export type UndoableOp = 'set_post_hidden' | 'set_post_approved';

export interface UndoEntry {
  postId: string;
  op: UndoableOp;
  /** Body args for callManagerApi that restore the previous value. */
  args: Record<string, unknown>;
  /** Optimistic patch to re-apply locally while the undo call is in flight. */
  patch: Partial<Pick<Post, 'hidden' | 'approved'>>;
  /** What the operator just did, phrased so "Undo" beside it makes sense. */
  label: string;
}

/**
 * Built from the post as it was BEFORE the change, so the entry restores the
 * real prior value rather than assuming a toggle started from the default.
 */
export function undoEntryFor(
  before: Post,
  change: { hidden?: boolean; approved?: boolean },
): UndoEntry | null {
  if (change.hidden !== undefined && change.hidden !== before.hidden) {
    return {
      postId: before.id,
      op: 'set_post_hidden',
      args: { postId: before.id, hidden: before.hidden },
      patch: { hidden: before.hidden },
      label: change.hidden ? 'Hidden from the wall' : 'Back on the wall',
    };
  }
  if (change.approved !== undefined && change.approved !== before.approved) {
    return {
      postId: before.id,
      op: 'set_post_approved',
      args: { postId: before.id, approved: before.approved },
      patch: { approved: before.approved },
      label: change.approved ? 'Approved' : 'Approval removed',
    };
  }
  return null;
}
