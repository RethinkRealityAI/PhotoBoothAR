/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * wallFindYours: the pure rules for "Find yours on the wall".
 *
 * The booth's success screen links a guest to `${basePath}/wall?post=<id>`.
 * The wall opens its lightbox on that photo when it is on the wall. When it
 * is not (the host approves posts first, say), it shows a short note and
 * keeps watching, so the photo pops up once it arrives. The param is removed
 * after it is read, so a refresh never reopens it.
 *
 * Also the phone-only "Mine" filter, which narrows the wall to this device's
 * own posts (the same device-local ids behind the "Yours" chip).
 */
import { isPostId } from './wallReactions';

export const POST_PARAM = 'post';

/** The validated `?post=` id from a location search string, else null. */
export function readPostParam(search: string): string | null {
  let v: string | null;
  try {
    v = new URLSearchParams(search).get(POST_PARAM);
  } catch {
    return null;
  }
  return v !== null && isPostId(v) ? v : null;
}

/** The search string with `?post=` removed ('' when nothing else is left).
 *  Every other param survives, in order. */
export function stripPostParam(search: string): string {
  const p = new URLSearchParams(search);
  if (!p.has(POST_PARAM)) return search;
  p.delete(POST_PARAM);
  const rest = p.toString();
  return rest === '' ? '' : `?${rest}`;
}

export type FindDecision =
  /** The first load has not finished: decide nothing yet. */
  | 'wait'
  /** It is on the wall: open the lightbox on it. */
  | 'open'
  /** Loaded and not there (awaiting approval, or hidden): show the note, keep watching. */
  | 'pending'
  /** The load failed: the wall shows its own error, so stay quiet. */
  | 'drop';

export function findDecision(
  target: string,
  postIds: readonly string[],
  loaded: boolean,
  failed: boolean,
): FindDecision {
  if (postIds.includes(target)) return 'open';
  if (failed) return 'drop';
  if (!loaded) return 'wait';
  return 'pending';
}

/** Phones only: the Mine filter is for a guest browsing, never a venue screen. */
export const MINE_MAX_WIDTH = 640;

/** Whether the Mine chip shows. Hidden on wide screens, while projecting, and
 *  when this device has nothing on the wall. */
export function mineChipVisible(opts: { width: number; projecting: boolean; mineCount: number }): boolean {
  return opts.width < MINE_MAX_WIDTH && !opts.projecting && opts.mineCount > 0;
}

/** This device's posts, in wall order. */
export function minePosts<T extends { id: string }>(posts: readonly T[], savedIds: ReadonlySet<string>): T[] {
  return posts.filter((p) => savedIds.has(p.id));
}
