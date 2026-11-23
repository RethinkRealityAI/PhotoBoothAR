/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Your first guest photo just landed": the dashboard watches a live event
 * that has no photos yet and celebrates the first one that arrives. Pure
 * policy here (which events to watch, which inserts count, how the cover
 * updates); the realtime subscription and the card live in the page.
 */

/** Realtime channels are cheap but not free; a host rarely has more than one
 *  brand-new live event at a time. */
export const MAX_FIRST_PHOTO_WATCHES = 3;

export interface FirstPhotoCandidate {
  id: string;
  slug: string;
  status: string | null | undefined;
  /** The event's photo count from the cover read. `undefined` = not loaded or
   *  the read failed: never watched, because "unknown" must not be treated
   *  as "zero" (the celebration would fire on photo 40). */
  count: number | undefined;
}

/** Live events whose count is known to be exactly zero, in list order. */
export function firstPhotoWatchSlugs(list: readonly FirstPhotoCandidate[]): string[] {
  return list
    .filter((e) => e.status === 'live' && e.count === 0 && e.slug.length > 0)
    .slice(0, MAX_FIRST_PHOTO_WATCHES)
    .map((e) => e.slug);
}

/** A hidden (moderated-away) insert is not something to celebrate. */
export function isCelebratablePost(post: { hidden?: boolean | null } | null | undefined): boolean {
  return !!post && post.hidden !== true;
}

export interface CoverLike { thumbs: string[]; count: number }

/** The cover after a new post arrives: one more moment, and the photo first
 *  in the thumbnails (videos count but are never thumbnails). Never mutates. */
export function coverWithPost(
  cover: CoverLike | undefined,
  post: { image_url: string; media_type: string | null | undefined },
): CoverLike {
  const thumbs = cover?.thumbs ?? [];
  const count = cover?.count ?? 0;
  const isImage = post.media_type !== 'video' && typeof post.image_url === 'string' && post.image_url.length > 0;
  return {
    count: count + 1,
    thumbs: isImage ? [post.image_url, ...thumbs.filter((t) => t !== post.image_url)].slice(0, 4) : thumbs,
  };
}
